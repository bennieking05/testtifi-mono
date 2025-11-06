const { sendEmail } = require('./backend/src/lib/sendEmail');

async function testEmail() {
  try {
    console.log('Testing email system...');
    await sendEmail(
      'bennieking5@gmail.com',
      'Test Email from Testifi AI',
      'This is a test email to verify the email system is working.',
      '<p>This is a test email to verify the email system is working.</p>'
    );
    console.log('✅ Email sent successfully!');
  } catch (error) {
    console.error('❌ Email failed:', error.message);
  }
}

testEmail();
















