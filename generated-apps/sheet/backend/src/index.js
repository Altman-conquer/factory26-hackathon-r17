const app = require('./app');
const defaultPort = 3000;
const port = Number(process.env.PORT || defaultPort);

async function start() {
  try {
    await app.locals.startupPromise;
  } catch (error) {
    console.error('Database initialization failed:', error);
    process.exitCode = 1;
    return;
  }

  app.listen(port, () => {
    console.log(`Backend listening at http://127.0.0.1:${port}`);
  });
}

start();
