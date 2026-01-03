// Test script to check what email is being generated for purchase receipts
// Run from backend directory: cd backend && node ../test-purchase-email.js
const fs = require('fs');
const path = require('path');

async function testPurchaseReceiptEmail() {
  try {

    // Import the function (we'll need to simulate it)
    // Actually, let's just test the logo loading logic
    const frontendUrl = (process.env.BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
    
    console.log('\n=== Testing Logo Loading ===');
    let logoSrc = `${frontendUrl}/testifi_dark_logo.png`;
    const logoPaths = [
      path.resolve(process.cwd(), "backend/public/testifi_light_logo.png"),
      path.resolve(process.cwd(), "public/testifi_light_logo.png"),
      path.resolve(__dirname, "../backend/public/testifi_light_logo.png"),
      path.resolve(process.cwd(), "backend/public/testifi_dark_logo.png"),
      path.resolve(process.cwd(), "public/testifi_dark_logo.png"),
    ];
    
    console.log('Checking logo paths:');
    for (const logoPath of logoPaths) {
      const exists = fs.existsSync(logoPath);
      console.log(`  ${exists ? '✓' : '✗'} ${logoPath}`);
      if (exists && logoSrc === `${frontendUrl}/testifi_dark_logo.png`) {
        const logoBuf = fs.readFileSync(logoPath);
        const logoBase64 = logoBuf.toString("base64");
        logoSrc = `data:image/png;base64,${logoBase64}`;
        console.log(`  → Using: ${logoPath} (${logoBuf.length} bytes, base64 length: ${logoBase64.length})`);
      }
    }
    
    console.log(`\nFinal logo source type: ${logoSrc.startsWith('data:') ? 'BASE64 EMBEDDED' : 'URL'}`);
    console.log(`Logo source preview: ${logoSrc.substring(0, 100)}...`);
    
    // Now let's check what the actual email HTML would look like
    console.log('\n=== Testing Email HTML Generation ===');
    const testCredits = 1;
    const testAmountCents = 13531;
    const testSubtotal = 125.00;
    const testTax = 10.31;
    const testTotal = 135.31;
    const testPaymentIntentId = 'pi_test_1234567890';
    
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Purchase Receipt</title>
</head>
<body>
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff;">
    <div style="background-color: #5674BC; padding: 24px 16px; text-align: center;">
      <img src="${logoSrc}" alt="Testifi AI" style="display: block; margin: 0 auto; max-width: 200px; height: auto;" />
    </div>
    <div style="padding: 32px 24px;">
      <h2>Thank You for Your Purchase</h2>
      <p>Hi Test User,</p>
      <p>Thank you for your purchase. We've added <strong>${testCredits} summary credit</strong> to your Testifi AI account.</p>
      
      <div style="background-color: #f9f9f9; border-radius: 6px; padding: 20px; margin: 24px 0;">
        <div style="display: flex; justify-content: space-between; padding: 8px 0;">
          <span>Subtotal (${testCredits} credit):</span>
          <span>$${testSubtotal.toFixed(2)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; padding: 8px 0;">
          <span>Texas Sales Tax (8.25%):</span>
          <span>$${testTax.toFixed(2)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; padding: 8px 0; font-weight: bold; font-size: 18px; border-top: 2px solid #5674BC; margin-top: 8px; padding-top: 12px;">
          <span>Total:</span>
          <span>$${testTotal.toFixed(2)}</span>
        </div>
        <div style="font-size: 12px; color: #888; margin-top: 12px;">
          Payment ID: ${testPaymentIntentId}
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;

    console.log(`\nEmail HTML length: ${html.length} bytes`);
    console.log(`Logo in HTML: ${html.includes('data:image') ? 'YES (base64)' : html.includes('http') ? 'YES (URL)' : 'NO'}`);
    
    // Save to file for inspection
    const outputFile = path.join(__dirname, 'test-email-output.html');
    fs.writeFileSync(outputFile, html);
    console.log(`\n✓ Email HTML saved to: ${outputFile}`);
    console.log(`\nYou can open this file in a browser to see what the email looks like.`);
    
    // Also check the actual compiled code
    console.log('\n=== Checking Compiled Code ===');
    const compiledFile = path.join(__dirname, 'backend/dist/routes/purchaseRoutes.js');
    if (fs.existsSync(compiledFile)) {
      const compiledCode = fs.readFileSync(compiledFile, 'utf8');
      const hasLogoEmbedding = compiledCode.includes('data:image/png;base64');
      const hasLogoPaths = compiledCode.includes('testifi_light_logo.png') || compiledCode.includes('testifi_dark_logo.png');
      console.log(`Compiled code has logo embedding logic: ${hasLogoEmbedding ? 'YES' : 'NO'}`);
      console.log(`Compiled code references logo files: ${hasLogoPaths ? 'YES' : 'NO'}`);
    } else {
      console.log('Compiled file not found. Run: cd backend && npm run build');
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

testPurchaseReceiptEmail();

