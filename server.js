require('dotenv').config();
const express = require('express');
const axios = require('axios');
const sql = require('mssql');

const app = express();
const port = 3000;

// ========================
// SQL CONFIG
// ========================
const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    options: {
        encrypt: false,
        enableArithAbort: true
    }
};

async function callNhsoRealPerson(pid) {
  const url =
    `https://nhsoapi.nhso.go.th/nhsoendpoint/api/RealPerson?SOURCE_ID=10661&PID=${pid}`;

  const res = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${process.env.TOKEN}`
    },
    timeout: 10000 // กัน API ค้าง
  });

  return res.data;  // คืน JSON ที่ได้จาก NHSO
}

// ===== 3. main script =====
async function main() {
  let pool;

  const resultObj = { result: 0 }; // เทียบกับ $arr['result']

  try {
    // 3.1 connect DB
    pool = await sql.connect(dbConfig);

    // 3.2 query ดึงข้อมูล (เอา query จาก PHP มาแปะตรงนี้)
    const query = `
      SELECT VNPRES.VN
        ,replace(convert(varchar, VNPRES.VISITDATE, 111), '/', '-') as visit_date
        ,VNPRES.SUFFIX
        ,REF
        ,VNPRES.RIGHTCODE
        ,RightcodeRef_MapCode.RIGHTCODE_SSB
        ,SPONSOR
    FROM VNPRES
    JOIN VNMST ON VNPRES.VN = VNMST.VN and VNPRES.VISITDATE = VNMST.VISITDATE
    JOIN PATIENT_REF ON VNMST.HN = PATIENT_REF.HN and PATIENT_REF.REFTYPE = '01'
    LEFT JOIN Saraburi.dbo.RightcodeRef_MapCode ON VNPRES.RIGHTCODE = RightcodeRef_MapCode.RIGHTCODE
    WHERE VNPRES.VISITDATE = CONVERT(date,DATEADD(DAY, 1, getdate()))
    `;

    const rs = await pool.request().query(query);

    for (const row of rs.recordset) {
   
      // ===== 3.3 ยิง API =====
      let tempData;
      try {
        tempData = await callNhsoRealPerson(row.REF);
      } catch (e) {
        console.error('เรียก API error:', e.message);
        continue; // ข้ามแถวนี้ไปก่อน
      }

        // ===== 3.4 log ตาม status =====
        if (tempData.pid && tempData.pid !== '') {
            const mainInsclCode = tempData.mainInsclCode;
            const mainInsclName = tempData.mainInsclName;
            const subInsclCode = tempData.subInsclCode;
            const subInsclName = tempData.subInsclName;
            const hospSub = tempData.hospSub ?? null;
            const hospMainOp = tempData.hospMainOp ?? null;
            const hospMain = tempData.hospMain ?? null;

            const insertLog200 = `
                INSERT INTO Saraburi.dbo.Rightcode_Checkapp (VN,VISITDATE,SUFFIX,CID,RIGHTCODE,RIGHTCODE_SSB,SPONSOR,mainInsclCode,mainInsclName,subInsclCode,subInsclName,hospSub,hospMainOp,hospMain) 
                VALUES (@VN,@visit_date,@SUFFIX,@REF,@RIGHTCODE,@RIGHTCODE_SSB,@SPONSOR,@mainInsclCode,@mainInsclName,@subInsclCode,@subInsclName,@hospSub,@hospMainOp,@hospMain)
            `;

            const suffixValue = row.SUFFIX == null ? 0 : Number(row.SUFFIX);
            await pool.request()
                .input('VN', sql.VarChar, row.VN)
                .input('visit_date', sql.VarChar, row.visit_date)
                .input('SUFFIX', sql.TinyInt, suffixValue)
                .input('REF', sql.VarChar, row.REF)
                .input('RIGHTCODE', sql.VarChar, row.RIGHTCODE)
                .input('RIGHTCODE_SSB', sql.VarChar, row.RIGHTCODE_SSB)
                .input('SPONSOR', sql.VarChar, row.SPONSOR)
                .input('mainInsclCode', sql.VarChar, mainInsclCode)
                .input('mainInsclName', sql.VarChar, mainInsclName)
                .input('subInsclCode', sql.VarChar, subInsclCode)
                .input('subInsclName', sql.VarChar, subInsclName)
                .input('hospSub', sql.VarChar, hospSub)
                .input('hospMainOp', sql.VarChar, hospMainOp)
                .input('hospMain', sql.VarChar, hospMain)
                .query(insertLog200);

            resultObj.result = 1;
        } else {

            const insertLog400 = `
                INSERT INTO Saraburi.dbo.Rightcode_Checkapp (VN,VISITDATE,SUFFIX,CID,RIGHTCODE,RIGHTCODE_SSB,SPONSOR) 
                VALUES (@VN,@visit_date,@SUFFIX,@REF,@RIGHTCODE,@RIGHTCODE_SSB,@SPONSOR)
            `;

            const suffixValue = row.SUFFIX == null ? 0 : Number(row.SUFFIX);
            await pool.request()
                .input('VN', sql.VarChar, row.VN)
                .input('visit_date', sql.VarChar, row.visit_date)
                .input('SUFFIX', sql.TinyInt, suffixValue)
                .input('REF', sql.VarChar, row.REF)
                .input('RIGHTCODE', sql.VarChar, row.RIGHTCODE)
                .input('RIGHTCODE_SSB', sql.VarChar, row.RIGHTCODE_SSB)
                .input('SPONSOR', sql.VarChar, row.SPONSOR)
            .query(insertLog400);

            resultObj.result = 0;
        }
    }

    console.log(JSON.stringify(resultObj));
  } catch (err) {
    console.error('เกิดข้อผิดพลาดหลัก:', err);
  } finally {
    if (pool) {
      await pool.close();
    }
  }
}

const cron = require('node-cron');

cron.schedule('0 22 * * *', () => {
    console.log("Scheduling RightCode API pm 22:00");
    main();   
});

main();