if (process.env.TEST_DATABASE_URL && process.env.TEST_DATABASE_URL !== '') {
  console.log('TEST_DB_SET');
} else {
  console.log('TEST_DB_MISSING');
}
