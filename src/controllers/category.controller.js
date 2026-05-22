const { poolPromise } = require("../config/db");
const { sql } = require("../config/db");

// Lấy toàn bộ danh mục sản phẩm kèm thông tin danh mục cha nếu có.
const getCategories = async (req, res) => {
  try {
    const pool = await poolPromise;

    const result = await pool.request().query(`
      SELECT
        c.id,
        c.name,
        c.parent_id,
        p.name AS parent_name
      FROM product_categories c
      LEFT JOIN product_categories p ON p.id = c.parent_id
      ORDER BY
        CASE WHEN c.parent_id IS NULL THEN 0 ELSE 1 END,
        c.id
    `);

    return res.status(200).json({
      success: true,
      categories: result.recordset,
    });
  } catch (error) {
    console.error("Get categories error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

// Tạo danh mục mới và kiểm tra tính hợp lệ của cấu trúc cha-con.
const createCategory = async (req, res) => {
  try {
    const { name, parent_id } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({
        success: false,
        message: "Category name is required.",
      });
    }

    const normalizedName = String(name).trim();
    const normalizedParentId =
      parent_id === null || parent_id === "" || parent_id === undefined
        ? null
        : Number(parent_id);

    if (normalizedParentId !== null && Number.isNaN(normalizedParentId)) {
      return res.status(400).json({
        success: false,
        message: "parent_id must be a valid number or null.",
      });
    }

    const pool = await poolPromise;

    if (normalizedParentId !== null) {
      const parentResult = await pool
        .request()
        .input("ParentId", sql.Int, normalizedParentId)
        .query(`
          SELECT id, name
          FROM product_categories
          WHERE id = @ParentId AND parent_id IS NULL
        `);

      if (!parentResult.recordset.length) {
        return res.status(400).json({
          success: false,
          message: "Parent category does not exist or is not a root category.",
        });
      }
    }

    const duplicateResult = await pool
      .request()
      .input("Name", sql.NVarChar(255), normalizedName)
      .input("ParentId", sql.Int, normalizedParentId)
      .query(`
        SELECT TOP 1 id
        FROM product_categories
        WHERE name = @Name
          AND (
            (@ParentId IS NULL AND parent_id IS NULL)
            OR parent_id = @ParentId
          )
      `);

    if (duplicateResult.recordset.length) {
      return res.status(409).json({
        success: false,
        message: "Category already exists.",
      });
    }

    const insertResult = await pool
      .request()
      .input("Name", sql.NVarChar(255), normalizedName)
      .input("ParentId", sql.Int, normalizedParentId)
      .query(`
        INSERT INTO product_categories (name, parent_id)
        OUTPUT INSERTED.id, INSERTED.name, INSERTED.parent_id
        VALUES (@Name, @ParentId)
      `);

    return res.status(201).json({
      success: true,
      message: "Category created successfully.",
      category: insertResult.recordset[0],
    });
  } catch (error) {
    console.error("Create category error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

// Xóa danh mục khi không còn danh mục con phụ thuộc.
const deleteCategory = async (req, res) => {
  try {
    const categoryId = Number(req.params.id);

    if (Number.isNaN(categoryId)) {
      return res.status(400).json({
        success: false,
        message: "Category id is invalid.",
      });
    }

    const pool = await poolPromise;

    const categoryResult = await pool
      .request()
      .input("CategoryId", sql.Int, categoryId)
      .query(`
        SELECT id, name, parent_id
        FROM product_categories
        WHERE id = @CategoryId
      `);

    const category = categoryResult.recordset[0];

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found.",
      });
    }

    const childResult = await pool
      .request()
      .input("CategoryId", sql.Int, categoryId)
      .query(`
        SELECT COUNT(*) AS child_count
        FROM product_categories
        WHERE parent_id = @CategoryId
      `);

    const childCount = childResult.recordset[0]?.child_count || 0;

    if (childCount > 0) {
      return res.status(409).json({
        success: false,
        message: "Cannot delete a parent category that still has child categories.",
      });
    }

    await pool
      .request()
      .input("CategoryId", sql.Int, categoryId)
      .query(`
        DELETE FROM product_categories
        WHERE id = @CategoryId
      `);

    return res.status(200).json({
      success: true,
      message: "Category deleted successfully.",
      categoryId,
    });
  } catch (error) {
    console.error("Delete category error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

module.exports = { getCategories, createCategory, deleteCategory };
