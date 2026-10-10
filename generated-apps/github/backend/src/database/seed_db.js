const { closeDb, initializeDatabase, getDb } = require('./init_db');
const { seedData } = require('./seed_data');

async function seedDatabase() {
  await initializeDatabase();
  await seedData(getDb());
}

if (require.main === module) {
  seedDatabase()
    .then(() => closeDb())
    .catch((error) => {
      console.error('Database seed failed:', error);
      process.exitCode = 1;
    });
}

module.exports = seedDatabase;
module.exports.seedDatabase = seedDatabase;
module.exports.seed = seedDatabase;
