import { GetServerSideProps } from 'next';
import querystring from 'querystring';
import config from '../config';
import utils from '../utils';
import Head from 'next/head';
import Nav from '../components/home/Nav';
import Input from '../components/search/Input';
import Total from '../components/search/Total';
import Sort from '../components/search/Sort';
import List, { DEFAULT_SEARCH_QUERY } from '../components/search/List';
import { initializeApollo } from '../lib/apolloClient';

function Search({ variables }) {
  return (
    <>
      <Head>
        <title>Portal | Search</title>
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <Nav />
      <main className="p-6">
        <Input />
        <Total variables={variables} />
        <Sort />
        <List variables={variables} />
      </main>
    </>
  );
}

export const getServerSideProps: GetServerSideProps = async (context) => {
  const query = context.query || {};
  const ckanQuery = utils.convertToCkanSearchQuery(query);

  const apolloClient = initializeApollo();
  const variables = {
    query: { q: ckanQuery.q || '' },
  };

  await apolloClient.query({
    query: DEFAULT_SEARCH_QUERY,
    variables,
  });

  return {
    props: {
      initialApolloState: apolloClient.cache.extract(),
      variables,
    },
  };
};

export default Search;
