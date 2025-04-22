const mysql = require('mysql2');

const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'Sumeet@123',
  database: 'cc_project'
});

db.connect(err => {
  if (err) throw err;
  console.log('✅ MySQL Connected!');
});

module.exports = db;
