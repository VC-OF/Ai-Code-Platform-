import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Idempotent: create default company row if missing
  const existing = await prisma.company.findFirst();
  if (!existing) {
    await prisma.company.create({
      data: {
        name: "株式会社 Ideal Folks",
        nameEn: "Ideal Folks Inc.",
        registrationNo: "T1234567890123",
        postalCode: "150-0001",
        address: "東京都渋谷区神宮前1-2-3 Ideal Folksビル 5F",
        tel: "03-1234-5678",
        email: "billing@idealfolks.co.jp",
        bankInfo:
          "三菱UFJ銀行 渋谷支店（普通）1234567\nカブシキガイシャ アイデアルフォークス",
        logoText: "IDEAL FOLKS",
        taxNote:
          "※ 本請求書は適格請求書です。\n※ 振込手数料は貴社ご負担にてお願いいたします。",
        defaultTaxRate: 10,
        invoicePrefix: "IF",
        nextInvoiceSeq: 1,
      },
    });
  }

  // Sample customers
  const customerCount = await prisma.customer.count();
  if (customerCount === 0) {
    await prisma.customer.createMany({
      data: [
        {
          name: "株式会社サクラ商事",
          nameKana: "カブシキガイシャサクラショウジ",
          honorific: "御中",
          postalCode: "104-0061",
          address: "東京都中央区銀座4-5-6 サクラビル 3F",
          registrationNo: "T9876543210987",
          tel: "03-9876-5432",
          email: "ap@sakura-shoji.co.jp",
        },
        {
          name: "山田 太郎",
          nameKana: "ヤマダ タロウ",
          honorific: "様",
          postalCode: "220-0011",
          address: "神奈川県横浜市西区高島1-2-3",
          tel: "045-111-2222",
        },
      ],
    });
  }

  // Sample products
  const productCount = await prisma.product.count();
  if (productCount === 0) {
    await prisma.product.createMany({
      data: [
        {
          code: "WEB-DEV",
          name: "Web開発サービス",
          unitPrice: 50000,
          taxRate: 10,
          unit: "時間",
        },
        {
          code: "DSGN-UI",
          name: "UIデザイン",
          unitPrice: 30000,
          taxRate: 10,
          unit: "時間",
        },
        {
          code: "CONSULT",
          name: "コンサルティング",
          unitPrice: 80000,
          taxRate: 10,
          unit: "回",
        },
        {
          code: "FOOD-1",
          name: "お茶（軽減税率対象）",
          unitPrice: 150,
          taxRate: 8,
          unit: "本",
        },
      ],
    });
  }

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
