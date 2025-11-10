/*
  Fix email template branding inside the Email table.
  Usage:
    DATABASE_URL="mysql://..." node backend/scripts/fix-email-branding.js
*/

const { PrismaClient } = require("@prisma/client");

function normalizeBrand(input) {
  if (!input) return input;
  // Replace hyphen/dash variants between "Testifi" and "AI" with a single space
  return input.replace(/Testifi[\-‑–—]AI/g, "Testifi AI");
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const emails = await prisma.email.findMany();
    let updated = 0;
    for (const e of emails) {
      const newSubject = normalizeBrand(e.subject);
      const newBody = normalizeBrand(e.body);
      if (newSubject !== e.subject || newBody !== e.body) {
        await prisma.email.update({
          where: { id: e.id },
          data: { subject: newSubject, body: newBody },
        });
        updated += 1;
        console.log(`Updated Email id=${e.id}`);
      }
    }
    console.log(`Done. Updated ${updated} template(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});









