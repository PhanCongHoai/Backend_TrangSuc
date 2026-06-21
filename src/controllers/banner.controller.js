const { poolPromise, sql } = require("../config/db");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Lưu ảnh banner dạng base64 thành file vật lý và trả về URL public.
const saveBannerImage = (req, imageValue) => {
  const normalizedValue = String(imageValue || "").trim();

  if (!normalizedValue) {
    return null;
  }

  if (!normalizedValue.startsWith("data:image/")) {
    return normalizedValue;
  }

  const matches = normalizedValue.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);

  if (!matches) {
    throw new Error("Dinh dang anh banner khong hop le.");
  }

  const extension = matches[1] === "jpeg" ? "jpg" : matches[1].toLowerCase();
  const fileBuffer = Buffer.from(matches[2], "base64");
  const uploadsDir = path.resolve(__dirname, "../../uploads/banners");

  fs.mkdirSync(uploadsDir, { recursive: true });

  const fileName = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${extension}`;
  const filePath = path.join(uploadsDir, fileName);

  fs.writeFileSync(filePath, fileBuffer);

  return `/uploads/banners/${fileName}`;
};

// Chuẩn hóa danh sách ảnh banner đầu vào từ payload một ảnh hoặc nhiều ảnh.
const normalizeBannerImageInputs = (req) => {
  const imageItems = Array.isArray(req.body?.image_urls)
    ? req.body.image_urls
    : [req.body?.image_url];

  return imageItems
    .map((imageValue) => saveBannerImage(req, imageValue))
    .filter(Boolean);
};

// Xóa file banner cục bộ tương ứng nếu URL trỏ tới thư mục uploads của hệ thống.
const removeLocalBannerImage = (imageUrl) => {
  try {
    const normalizedUrl = String(imageUrl || "");
    const marker = "/uploads/banners/";
    const markerIndex = normalizedUrl.indexOf(marker);

    if (markerIndex < 0) {
      return;
    }

    const fileName = decodeURIComponent(
      normalizedUrl.slice(markerIndex + marker.length).split(/[?#]/)[0]
    );

    if (!fileName || fileName.includes("/") || fileName.includes("\\")) {
      return;
    }

    const filePath = path.resolve(__dirname, "../../uploads/banners", fileName);
    const uploadsDir = path.resolve(__dirname, "../../uploads/banners");

    if (!filePath.startsWith(uploadsDir)) {
      return;
    }

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.error("Remove local banner image error:", error);
  }
};

// Lấy banner trang chủ cho phía client.
const getHomeHeroBanner = async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT
        id,
        image_url
      FROM marketing_banners
      WHERE image_url IS NOT NULL
      ORDER BY id DESC
    `);

    res.set({
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
      "Surrogate-Control": "no-store",
    });

    return res.status(200).json({
      success: true,
      banner: result.recordset[0] || null,
      banners: result.recordset,
    });
  } catch (error) {
    console.error("Get home hero banner error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

// Lấy banner trang chủ cho phía quản trị.
const getAdminHomeHeroBanner = async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT
        id,
        image_url
      FROM marketing_banners
      WHERE image_url IS NOT NULL
      ORDER BY id DESC
    `);

    return res.status(200).json({
      success: true,
      banner: result.recordset[0] || null,
      banners: result.recordset,
    });
  } catch (error) {
    console.error("Get admin home hero banner error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

// Tạo mới hoặc cập nhật banner trang chủ trong khu vực quản trị.
const upsertAdminHomeHeroBanner = async (req, res) => {
  try {
    const pool = await poolPromise;
    const normalizedImageUrls = normalizeBannerImageInputs(req);

    if (!normalizedImageUrls.length) {
      return res.status(400).json({
        success: false,
        message: "Anh banner la bat buoc.",
      });
    }

    const savedBanners = [];

    for (const normalizedImageUrl of normalizedImageUrls) {
      const result = await pool
        .request()
        .input("ImageUrl", sql.VarChar(255), normalizedImageUrl)
        .query(`
          INSERT INTO marketing_banners (image_url)
          OUTPUT INSERTED.id, INSERTED.image_url
          VALUES (@ImageUrl)
        `);

      if (result.recordset[0]) {
        savedBanners.push(result.recordset[0]);
      }
    }

    return res.status(201).json({
      success: true,
      message: `Them ${savedBanners.length} banner thanh cong.`,
      banner: savedBanners[0] || null,
      banners: savedBanners,
    });
  } catch (error) {
    console.error("Upsert admin home hero banner error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Server error.",
    });
  }
};

// Xóa một banner khỏi database và dọn file cục bộ nếu cần.
const deleteAdminHomeHeroBanner = async (req, res) => {
  const bannerId = Number(req.params.id);

  if (Number.isNaN(bannerId) || bannerId <= 0) {
    return res.status(400).json({
      success: false,
      message: "Banner id khong hop le.",
    });
  }

  try {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input("BannerId", sql.Int, bannerId)
      .query(`
        DELETE FROM marketing_banners
        OUTPUT DELETED.id, DELETED.image_url
        WHERE id = @BannerId
      `);

    const deletedBanner = result.recordset[0];

    if (!deletedBanner) {
      return res.status(404).json({
        success: false,
        message: "Khong tim thay banner de xoa.",
      });
    }

    removeLocalBannerImage(deletedBanner.image_url);

    return res.status(200).json({
      success: true,
      message: "Xoa banner thanh cong.",
      banner: deletedBanner,
    });
  } catch (error) {
    console.error("Delete admin home hero banner error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

module.exports = {
  getHomeHeroBanner,
  getAdminHomeHeroBanner,
  upsertAdminHomeHeroBanner,
  deleteAdminHomeHeroBanner,
};
