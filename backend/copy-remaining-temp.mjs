import mysql from 'mysql2/promise';

const config = {
  host: '34.41.210.164',
  user: 'system',
  password: 'cuqGxC709)Y$(@N@',
};

async function copyTable(prodConn, stagingConn, table, columns) {
  const [rows] = await prodConn.query(`SELECT * FROM \`${table}\``);
  console.log(`  ${table}: ${rows.length} rows in production`);
  if (rows.length === 0) return;

  await stagingConn.query(`DELETE FROM \`${table}\``);

  for (const row of rows) {
    const cols = columns || Object.keys(row);
    const placeholders = cols.map(() => '?').join(', ');
    const values = cols.map(c => row[c]);
    await stagingConn.query(
      `INSERT INTO \`${table}\` (${cols.map(c => '`'+c+'`').join(', ')}) VALUES (${placeholders})`,
      values
    );
  }
  
  const [count] = await stagingConn.query(`SELECT COUNT(*) as c FROM \`${table}\``);
  console.log(`  ${table}: ${count[0].c} rows copied to staging ✅`);
}

async function main() {
  const prodConn = await mysql.createConnection({ ...config, database: 'deposition_ai' });
  const stagingConn = await mysql.createConnection({ ...config, database: 'deposition_ai_staging' });

  try {
    console.log('Copying remaining tables to staging...\n');
    await stagingConn.query('SET FOREIGN_KEY_CHECKS = 0');

    // File table
    await copyTable(prodConn, stagingConn, 'File', [
      'id', 'fileName', 'fileUrl', 'createdAt', 'userId', 'summaryFileName', 
      'summaryUrl', 'pages', 'deponent', 'title'
    ]);

    // SummaryJob table - check which columns exist in staging
    const [stagingCols] = await stagingConn.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'deposition_ai_staging' AND TABLE_NAME = 'SummaryJob'`
    );
    const stagingColNames = stagingCols.map(r => r.COLUMN_NAME);
    const summaryJobCols = [
      'id', 'userId', 'fileId', 'fileName', 'fileUrl', 'summaryCsvUrl',
      'status', 'lastPageProcessed', 'totalPages', 'error', 'notifyOnComplete',
      'startedAt', 'finishedAt', 'completionEmailSentAt', 'createdAt', 'updatedAt'
    ].filter(c => stagingColNames.includes(c));
    console.log(`  SummaryJob columns available: ${summaryJobCols.length}`);
    
    // Add missing column if needed
    if (!stagingColNames.includes('completionEmailSentAt')) {
      console.log('  Adding missing completionEmailSentAt column...');
      await stagingConn.query('ALTER TABLE SummaryJob ADD COLUMN completionEmailSentAt DATETIME NULL');
      summaryJobCols.push('completionEmailSentAt');
    }
    
    await copyTable(prodConn, stagingConn, 'SummaryJob', summaryJobCols);

    // DownloadHistory table
    await copyTable(prodConn, stagingConn, 'DownloadHistory', [
      'id', 'userId', 'fileId', 'format', 'createdAt'
    ]);

    // SupportTicket + SupportReply
    await copyTable(prodConn, stagingConn, 'SupportTicket', [
      'id', 'userId', 'name', 'email', 'subject', 'message', 'status', 'createdAt', 'updatedAt'
    ]);
    await copyTable(prodConn, stagingConn, 'SupportReply', [
      'id', 'ticketId', 'from', 'message', 'createdAt'
    ]);

    // Email table
    await copyTable(prodConn, stagingConn, 'Email', [
      'id', 'subject', 'body'
    ]);

    // TrainingAsset
    await copyTable(prodConn, stagingConn, 'TrainingAsset', [
      'id', 'userId', 'type', 'filename', 'fileSize', 'uploadedAt', 'description'
    ]);

    await stagingConn.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('\n✅ All tables copied!');

  } finally {
    await prodConn.end();
    await stagingConn.end();
  }
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
