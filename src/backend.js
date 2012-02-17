// # Recline Backends
//
// Backends are connectors to backend data sources and stores
//
// Backends are implemented as Backbone models but this is just a
// convenience (they do not save or load themselves from any remote
// source)
this.recline = this.recline || {};
this.recline.Model = this.recline.Model || {};

(function($, my) {
  // ## Backbone.sync
  //
  // Override Backbone.sync to hand off to sync function in relevant backend
  Backbone.sync = function(method, model, options) {
    return model.backend.sync(method, model, options);
  }

  // ## wrapInTimeout
  // 
  // Crude way to catch backend errors
  // Many of backends use JSONP and so will not get error messages and this is
  // a crude way to catch those errors.
  function wrapInTimeout(ourFunction) {
    var dfd = $.Deferred();
    var timeout = 5000;
    var timer = setTimeout(function() {
      dfd.reject({
        message: 'Request Error: Backend did not respond after ' + (timeout / 1000) + ' seconds'
      });
    }, timeout);
    ourFunction.done(function(arguments) {
        clearTimeout(timer);
        dfd.resolve(arguments);
      })
      .fail(function(arguments) {
        clearTimeout(timer);
        dfd.reject(arguments);
      })
      ;
    return dfd.promise();
  }

  // ## BackendMemory - uses in-memory data
  //
  // This is very artificial and is really only designed for testing
  // purposes.
  //
  // To use it you should provide in your constructor data:
  // 
  //   * metadata (including headers array)
  //   * documents: list of hashes, each hash being one doc. A doc *must* have an id attribute which is unique.
  //
  //  Example:
  // 
  //  <pre>
  //  // Backend setup
  //  var backend = Backend();
  //  backend.addDataset({
  //    metadata: {
  //      id: 'my-id',
  //      title: 'My Title',
  //      headers: ['x', 'y', 'z'],
  //    },
  //    documents: [
  //        {id: 0, x: 1, y: 2, z: 3},
  //        {id: 1, x: 2, y: 4, z: 6}
  //      ]
  //  });
  //  // later ...
  //  var dataset = Dataset({id: 'my-id'});
  //  dataset.fetch();
  //  etc ...
  //  </pre>
  my.BackendMemory = Backbone.Model.extend({
    initialize: function() {
      this.datasets = {};
    },
    addDataset: function(data) {
      this.datasets[data.metadata.id] = $.extend(true, {}, data);
    },
    sync: function(method, model, options) {
      var self = this;
      if (method === "read") {
        var dfd = $.Deferred();
        if (model.__type__ == 'Dataset') {
          var rawDataset = this.datasets[model.id];
          model.set(rawDataset.metadata);
          model.docCount = rawDataset.documents.length;
          dfd.resolve(model);
        }
        return dfd.promise();
      } else if (method === 'update') {
        var dfd = $.Deferred();
        if (model.__type__ == 'Document') {
          _.each(self.datasets[model.dataset.id].documents, function(doc, idx) {
            if(doc.id === model.id) {
              self.datasets[model.dataset.id].documents[idx] = model.toJSON();
            }
          });
          dfd.resolve(model);
        }
        return dfd.promise();
      } else if (method === 'delete') {
        var dfd = $.Deferred();
        if (model.__type__ == 'Document') {
          var rawDataset = self.datasets[model.dataset.id];
          var newdocs = _.reject(rawDataset.documents, function(doc) {
            return (doc.id === model.id);
          });
          rawDataset.documents = newdocs;
          dfd.resolve(model);
        }
        return dfd.promise();
      } else {
        alert('Not supported: sync on BackendMemory with method ' + method + ' and model ' + model);
      }
    },
    query: function(model, queryObj) {
      var numRows = queryObj.size;
      var start = queryObj.offset;
      var dfd = $.Deferred();
      results = this.datasets[model.id].documents;
      // not complete sorting!
      _.each(queryObj.sort, function(item) {
        results = _.sortBy(results, function(doc) {
          var _out = doc[item[0]];
          return (item[1] == 'asc') ? _out : -1*_out;
        });
      });
      var results = results.slice(start, start+numRows);
      dfd.resolve(results);
      return dfd.promise();
    }
  });
  my.backends['memory'] = new my.BackendMemory();

  // ## BackendWebstore
  //
  // Connecting to [Webstores](http://github.com/okfn/webstore)
  //
  // To use this backend ensure your Dataset has a webstore_url in its attributes.
  my.BackendWebstore = Backbone.Model.extend({
    sync: function(method, model, options) {
      if (method === "read") {
        if (model.__type__ == 'Dataset') {
          var base = model.get('webstore_url');
          var schemaUrl = base + '/schema.json';
          var jqxhr = $.ajax({
            url: schemaUrl,
              dataType: 'jsonp',
              jsonp: '_callback'
          });
          var dfd = $.Deferred();
          wrapInTimeout(jqxhr).done(function(schema) {
            headers = _.map(schema.data, function(item) {
              return item.name;
            });
            model.set({
              headers: headers
            });
            model.docCount = schema.count;
            dfd.resolve(model, jqxhr);
          })
          .fail(function(arguments) {
            dfd.reject(arguments);
          });
          return dfd.promise();
        }
      }
    },
    query: function(model, queryObj) {
      var base = model.get('webstore_url');
      var data = {
        _limit:  queryObj.size
        , _offset: queryObj.offset
      };
      var jqxhr = $.ajax({
        url: base + '.json',
        data: data,
        dataType: 'jsonp',
        jsonp: '_callback',
        cache: true
      });
      var dfd = $.Deferred();
      jqxhr.done(function(results) {
        dfd.resolve(results.data);
      });
      return dfd.promise();
    }
  });
  my.backends['webstore'] = new my.BackendWebstore();

  // ## BackendDataProxy
  // 
  // For connecting to [DataProxy-s](http://github.com/okfn/dataproxy).
  //
  // When initializing the DataProxy backend you can set the following attributes:
  //
  // * dataproxy: {url-to-proxy} (optional). Defaults to http://jsonpdataproxy.appspot.com
  //
  // Datasets using using this backend should set the following attributes:
  //
  // * url: (required) url-of-data-to-proxy
  // * format: (optional) csv | xls (defaults to csv if not specified)
  //
  // Note that this is a **read-only** backend.
  my.BackendDataProxy = Backbone.Model.extend({
    defaults: {
      dataproxy_url: 'http://jsonpdataproxy.appspot.com'
    },
    sync: function(method, model, options) {
      var self = this;
      if (method === "read") {
        if (model.__type__ == 'Dataset') {
          var base = self.get('dataproxy_url');
          // TODO: should we cache for extra efficiency
          var data = {
            url: model.get('url')
            , 'max-results':  1
            , type: model.get('format') || 'csv'
          };
          var jqxhr = $.ajax({
            url: base
            , data: data
            , dataType: 'jsonp'
          });
          var dfd = $.Deferred();
          wrapInTimeout(jqxhr).done(function(results) {
            model.set({
              headers: results.fields
            });
            dfd.resolve(model, jqxhr);
          })
          .fail(function(arguments) {
            dfd.reject(arguments);
          });
          return dfd.promise();
        }
      } else {
        alert('This backend only supports read operations');
      }
    },
    query: function(dataset, queryObj) {
      var base = this.get('dataproxy_url');
      var data = {
        url: dataset.get('url')
        , 'max-results':  queryObj.size
        , type: dataset.get('format')
      };
      var jqxhr = $.ajax({
        url: base
        , data: data
        , dataType: 'jsonp'
      });
      var dfd = $.Deferred();
      jqxhr.done(function(results) {
        var _out = _.map(results.data, function(doc) {
          var tmp = {};
          _.each(results.fields, function(key, idx) {
            tmp[key] = doc[idx];
          });
          return tmp;
        });
        dfd.resolve(_out);
      });
      return dfd.promise();
    }
  });
  my.backends['dataproxy'] = new my.BackendDataProxy();


  // ## Google spreadsheet backend
  // 
  // Connect to Google Docs spreadsheet.
  //
  // Dataset must have a url attribute pointing to the Gdocs
  // spreadsheet's JSON feed e.g.
  //
  // <pre>
  // var dataset = new recline.Model.Dataset({
  //     url: 'https://spreadsheets.google.com/feeds/list/0Aon3JiuouxLUdDQwZE1JdV94cUd6NWtuZ0IyWTBjLWc/od6/public/values?alt=json'
  //   },
  //   'gdocs'
  // );
  // </pre>
  my.BackendGDoc = Backbone.Model.extend({
    sync: function(method, model, options) {
      var self = this;
      if (method === "read") { 
        var dfd = $.Deferred(); 
        var dataset = model;

        $.getJSON(model.get('url'), function(d) {
          result = self.gdocsToJavascript(d);
          model.set({'headers': result.header});
          // cache data onto dataset (we have loaded whole gdoc it seems!)
          model._dataCache = result.data;
          dfd.resolve(model);
        })
        return dfd.promise(); }
    },

    query: function(dataset, queryObj) { 
      var dfd = $.Deferred();
      var fields = dataset.get('headers');

      // zip the field headers with the data rows to produce js objs
      // TODO: factor this out as a common method with other backends
      var objs = _.map(dataset._dataCache, function (d) { 
        var obj = {};
        _.each(_.zip(fields, d), function (x) { obj[x[0]] = x[1]; })
        return obj;
      });
      dfd.resolve(objs);
      return dfd;
    },
    gdocsToJavascript:  function(gdocsSpreadsheet) {
      /*
         :options: (optional) optional argument dictionary:
         columnsToUse: list of columns to use (specified by header names)
         colTypes: dictionary (with column names as keys) specifying types (e.g. range, percent for use in conversion).
         :return: tabular data object (hash with keys: header and data).

         Issues: seems google docs return columns in rows in random order and not even sure whether consistent across rows.
         */
      var options = {};
      if (arguments.length > 1) {
        options = arguments[1];
      }
      var results = {
        'header': [],
        'data': []
      };
      // default is no special info on type of columns
      var colTypes = {};
      if (options.colTypes) {
        colTypes = options.colTypes;
      }
      // either extract column headings from spreadsheet directly, or used supplied ones
      if (options.columnsToUse) {
        // columns set to subset supplied
        results.header = options.columnsToUse;
      } else {
        // set columns to use to be all available
        if (gdocsSpreadsheet.feed.entry.length > 0) {
          for (var k in gdocsSpreadsheet.feed.entry[0]) {
            if (k.substr(0, 3) == 'gsx') {
              var col = k.substr(4)
                results.header.push(col);
            }
          }
        }
      }

      // converts non numberical values that should be numerical (22.3%[string] -> 0.223[float])
      var rep = /^([\d\.\-]+)\%$/;
      $.each(gdocsSpreadsheet.feed.entry, function (i, entry) {
        var row = [];
        for (var k in results.header) {
          var col = results.header[k];
          var _keyname = 'gsx$' + col;
          var value = entry[_keyname]['$t'];
          // if labelled as % and value contains %, convert
          if (colTypes[col] == 'percent') {
            if (rep.test(value)) {
              var value2 = rep.exec(value);
              var value3 = parseFloat(value2);
              value = value3 / 100;
            }
          }
          row.push(value);
        }
        results.data.push(row);
      });
      return results;
    }
  });
  my.backends['gdocs'] = new my.BackendGDoc();

}(jQuery, this.recline.Model));