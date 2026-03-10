#!/usr/bin/env node

/**
 * Create a test user for regression testing
 * 
 * Usage: node scripts/create-test-user.js
 */

// Load environment from backend/.env
require('dotenv').config({ path: require('path').join(__dirname, '..', 'backend', '.env') });

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const email = 'bennieking5+tester@gmail.com';
  const password = 'yourpassord';
  const name = 'Test User';
  const credits = 10; // Give some credits for testing
  
  console.log('Creating test user...');
  console.log(`  Email: ${email}`);
  console.log(`  Name: ${name}`);
  console.log(`  Credits: ${credits}`);
  
  // Hash the password
  const hashedPassword = await bcrypt.hash(password, 10);
  
  // Check if user already exists
  const existing = await prisma.user.findUnique({
    where: { email },
  });
  
  if (existing) {
    console.log('\n⚠️  User already exists. Updating password and credits...');
    
    const updated = await prisma.user.update({
      where: { email },
      data: {
        password: hashedPassword,
        credits,
        name,
      },
    });
    
    console.log('✅ User updated successfully!');
    console.log(`  ID: ${updated.id}`);
    console.log(`  Email: ${updated.email}`);
    console.log(`  Name: ${updated.name}`);
    console.log(`  Credits: ${updated.credits}`);
    console.log(`  Role: ${updated.role}`);
  } else {
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        credits,
        role: 'user',
        companyName: 'Test Company',
      },
    });
    
    console.log('\n✅ User created successfully!');
    console.log(`  ID: ${user.id}`);
    console.log(`  Email: ${user.email}`);
    console.log(`  Name: ${user.name}`);
    console.log(`  Credits: ${user.credits}`);
    console.log(`  Role: ${user.role}`);
  }
  
  // Also create the test-login.json file
  const fs = require('fs');
  const path = require('path');
  
  const testLoginPath = path.join(__dirname, '..', 'test-login.json');
  fs.writeFileSync(testLoginPath, JSON.stringify({
    email,
    password,
  }, null, 2));
  
  console.log(`\n📝 Created test-login.json at: ${testLoginPath}`);
}

main()
  .catch((err) => {
    console.error('❌ Error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

