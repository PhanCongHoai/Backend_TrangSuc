const { poolPromise } = require("../../config/db");

let isChatSchemaReady = false;
let schemaPromise = null;

// Bảo đảm toàn bộ schema chat đã tồn tại và nâng cấp dữ liệu cũ nếu cần.
const ensureChatSchema = async () => {
  if (isChatSchemaReady) {
    return;
  }

  if (schemaPromise) {
    return schemaPromise;
  }

  schemaPromise = (async () => {
    try {
      const pool = await poolPromise;

      await pool.request().query(`
        IF OBJECT_ID('dbo.chat_conversations', 'U') IS NULL
        BEGIN
          CREATE TABLE dbo.chat_conversations (
            id INT IDENTITY(1,1) PRIMARY KEY,
            user_id INT NULL,
            guest_key VARCHAR(120) NULL,
            guest_name NVARCHAR(120) NULL,
            status VARCHAR(30) NOT NULL CONSTRAINT DF_chat_conversations_status DEFAULT 'OPEN',
            created_at DATETIME NOT NULL CONSTRAINT DF_chat_conversations_created_at DEFAULT GETDATE(),
            updated_at DATETIME NOT NULL CONSTRAINT DF_chat_conversations_updated_at DEFAULT GETDATE(),
            last_message_at DATETIME NOT NULL CONSTRAINT DF_chat_conversations_last_message_at DEFAULT GETDATE(),
            admin_seen_at DATETIME NULL
          );
        END;

        IF COL_LENGTH('dbo.chat_conversations', 'user_id') IS NULL
        BEGIN
          ALTER TABLE dbo.chat_conversations ADD user_id INT NULL;
        END;

        IF COL_LENGTH('dbo.chat_conversations', 'guest_key') IS NULL
        BEGIN
          ALTER TABLE dbo.chat_conversations ADD guest_key VARCHAR(120) NULL;
        END;

        IF COL_LENGTH('dbo.chat_conversations', 'guest_name') IS NULL
        BEGIN
          ALTER TABLE dbo.chat_conversations ADD guest_name NVARCHAR(120) NULL;
        END;

        IF COL_LENGTH('dbo.chat_conversations', 'status') IS NULL
        BEGIN
          ALTER TABLE dbo.chat_conversations
          ADD status VARCHAR(30) NOT NULL CONSTRAINT DF_chat_conversations_status DEFAULT 'OPEN';
        END;

        IF COL_LENGTH('dbo.chat_conversations', 'created_at') IS NULL
        BEGIN
          ALTER TABLE dbo.chat_conversations
          ADD created_at DATETIME NOT NULL CONSTRAINT DF_chat_conversations_created_at DEFAULT GETDATE();
        END;

        IF COL_LENGTH('dbo.chat_conversations', 'updated_at') IS NULL
        BEGIN
          ALTER TABLE dbo.chat_conversations
          ADD updated_at DATETIME NOT NULL CONSTRAINT DF_chat_conversations_updated_at DEFAULT GETDATE();
        END;

        IF COL_LENGTH('dbo.chat_conversations', 'last_message_at') IS NULL
        BEGIN
          ALTER TABLE dbo.chat_conversations
          ADD last_message_at DATETIME NOT NULL CONSTRAINT DF_chat_conversations_last_message_at DEFAULT GETDATE();
        END;

        IF COL_LENGTH('dbo.chat_conversations', 'admin_seen_at') IS NULL
        BEGIN
          ALTER TABLE dbo.chat_conversations ADD admin_seen_at DATETIME NULL;
        END;

        IF OBJECT_ID('dbo.chat_messages', 'U') IS NULL
        BEGIN
          CREATE TABLE dbo.chat_messages (
            id INT IDENTITY(1,1) PRIMARY KEY,
            conversation_id INT NOT NULL,
            sender_type VARCHAR(20) NOT NULL,
            sender_user_id INT NULL,
            sender_name NVARCHAR(120) NOT NULL,
            message NVARCHAR(MAX) NOT NULL,
            image_url NVARCHAR(MAX) NULL,
            created_at DATETIME NOT NULL CONSTRAINT DF_chat_messages_created_at DEFAULT GETDATE(),
            CONSTRAINT FK_chat_messages_conversation
              FOREIGN KEY (conversation_id) REFERENCES dbo.chat_conversations(id) ON DELETE CASCADE
          );
        END;

        IF COL_LENGTH('dbo.chat_messages', 'sender_type') IS NULL
        BEGIN
          ALTER TABLE dbo.chat_messages ADD sender_type VARCHAR(20) NULL;
          UPDATE dbo.chat_messages
          SET sender_type =
            CASE
              WHEN LOWER(ISNULL(sender, '')) = 'admin' THEN 'admin'
              WHEN LOWER(ISNULL(sender, '')) = 'user' THEN 'user'
              ELSE 'guest'
            END
          WHERE sender_type IS NULL;
          ALTER TABLE dbo.chat_messages ALTER COLUMN sender_type VARCHAR(20) NOT NULL;
        END;

        IF COL_LENGTH('dbo.chat_messages', 'sender_user_id') IS NULL
        BEGIN
          ALTER TABLE dbo.chat_messages ADD sender_user_id INT NULL;
        END;

        IF COL_LENGTH('dbo.chat_messages', 'conversation_id') IS NULL
        BEGIN
          ALTER TABLE dbo.chat_messages ADD conversation_id INT NULL;
        END;

        IF COL_LENGTH('dbo.chat_messages', 'sender_name') IS NULL
        BEGIN
          ALTER TABLE dbo.chat_messages ADD sender_name NVARCHAR(120) NULL;
          UPDATE dbo.chat_messages
          SET sender_name =
            CASE
              WHEN LOWER(ISNULL(sender, '')) = 'admin' THEN N'Tư vấn viên'
              ELSE N'Khách hàng'
            END
          WHERE sender_name IS NULL;
          ALTER TABLE dbo.chat_messages ALTER COLUMN sender_name NVARCHAR(120) NOT NULL;
        END;

        IF COL_LENGTH('dbo.chat_messages', 'message') IS NULL
        BEGIN
          ALTER TABLE dbo.chat_messages ADD message NVARCHAR(MAX) NULL;
        END;

        IF COL_LENGTH('dbo.chat_messages', 'image_url') IS NULL
        BEGIN
          ALTER TABLE dbo.chat_messages ADD image_url NVARCHAR(MAX) NULL;
        END;

        IF COL_LENGTH('dbo.chat_messages', 'created_at') IS NULL
        BEGIN
          ALTER TABLE dbo.chat_messages
          ADD created_at DATETIME NOT NULL CONSTRAINT DF_chat_messages_created_at DEFAULT GETDATE();
        END;

        -- Thiet lap khoa ngoai lien ket voi bang users neu ton tai bang users
        IF OBJECT_ID('dbo.users', 'U') IS NOT NULL
        BEGIN
          -- 1. Don dep du lieu mo coi trong chat_conversations
          IF COL_LENGTH('dbo.chat_conversations', 'user_id') IS NOT NULL
          BEGIN
            UPDATE dbo.chat_conversations
            SET user_id = NULL
            WHERE user_id IS NOT NULL
              AND user_id NOT IN (SELECT id FROM dbo.users);
          END;

          -- 2. Them khoa ngoai cho chat_conversations neu chua co
          IF NOT EXISTS (
            SELECT 1 FROM sys.foreign_keys 
            WHERE name = 'FK_chat_conversations_users' 
              AND parent_object_id = OBJECT_ID('dbo.chat_conversations')
          )
          BEGIN
            ALTER TABLE dbo.chat_conversations
            ADD CONSTRAINT FK_chat_conversations_users
            FOREIGN KEY (user_id) REFERENCES dbo.users(id) ON DELETE SET NULL;
          END;

          -- 3. Don dep du lieu mo coi trong chat_messages
          IF COL_LENGTH('dbo.chat_messages', 'sender_user_id') IS NOT NULL
          BEGIN
            UPDATE dbo.chat_messages
            SET sender_user_id = NULL
            WHERE sender_user_id IS NOT NULL
              AND sender_user_id NOT IN (SELECT id FROM dbo.users);
          END;

          -- 4. Them khoa ngoai cho chat_messages neu chua co
          IF NOT EXISTS (
            SELECT 1 FROM sys.foreign_keys 
            WHERE name = 'FK_chat_messages_users' 
              AND parent_object_id = OBJECT_ID('dbo.chat_messages')
          )
          BEGIN
            ALTER TABLE dbo.chat_messages
            ADD CONSTRAINT FK_chat_messages_users
            FOREIGN KEY (sender_user_id) REFERENCES dbo.users(id) ON DELETE SET NULL;
          END;
        END;

        -- Them khoa ngoai lien ket giua chat_messages va chat_conversations neu chua co
        IF OBJECT_ID('dbo.chat_messages', 'U') IS NOT NULL
          AND OBJECT_ID('dbo.chat_conversations', 'U') IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM sys.foreign_keys 
            WHERE name = 'FK_chat_messages_conversation' 
              AND parent_object_id = OBJECT_ID('dbo.chat_messages')
          )
        BEGIN
          -- Xoa cac tin nhan mo coi khong thuoc cuoc hoi thoai nao
          DELETE FROM dbo.chat_messages
          WHERE conversation_id NOT IN (SELECT id FROM dbo.chat_conversations);

          ALTER TABLE dbo.chat_messages
          ADD CONSTRAINT FK_chat_messages_conversation
          FOREIGN KEY (conversation_id) REFERENCES dbo.chat_conversations(id) ON DELETE CASCADE;
        END;
      `);

      isChatSchemaReady = true;
    } catch (error) {
      schemaPromise = null;
      throw error;
    }
  })();

  return schemaPromise;
};

module.exports = {
  ensureChatSchema,
};
