require('dotenv').config({ path: 'c:/Users/ASUS/Documents/Demo/Web_TrangSuc1/Web_TrangSuc/backend/.env' });
const { poolPromise, sql } = require('../config/db.js');

const migrate = async () => {
  try {
    const pool = await poolPromise;
    console.log("Checking and creating return_requests table...");
    
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[return_requests]') AND type in (N'U'))
      BEGIN
          CREATE TABLE [dbo].[return_requests] (
              [id] INT IDENTITY(1,1) PRIMARY KEY,
              [order_id] INT NOT NULL,
              [user_id] INT NOT NULL,
              [bank_name] NVARCHAR(150) NOT NULL,
              [account_number] VARCHAR(50) NOT NULL,
              [account_holder_name] NVARCHAR(150) NOT NULL,
              [reason] NVARCHAR(500) NULL,
              [amount] DECIMAL(15,2) NOT NULL,
              [status] VARCHAR(50) NOT NULL DEFAULT 'PENDING',
              [admin_transferred] BIT NOT NULL DEFAULT 0,
              [transferred_at] DATETIME NULL,
              [created_at] DATETIME DEFAULT GETDATE(),
              [updated_at] DATETIME DEFAULT GETDATE(),
              CONSTRAINT FK_return_requests_orders FOREIGN KEY (order_id) REFERENCES orders(id),
              CONSTRAINT FK_return_requests_users FOREIGN KEY (user_id) REFERENCES users(id)
          )
          PRINT 'Table return_requests created successfully.'
      END
      ELSE
      BEGIN
          PRINT 'Table return_requests already exists.'
      END
    `);
    console.log("Migration finished.");
  } catch (error) {
    console.error("Migration failed:", error);
  } finally {
    process.exit(0);
  }
};

migrate();
