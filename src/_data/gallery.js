const fs = require("fs");
const path = require("path");

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"]);

function toAltText(filename) {
  return filename
    .replace(/\.[^/.]+$/, "")
    .replace(/[-_]+/g, " ")
    .trim();
}

function loadDateMap() {
  const datePath = path.join(__dirname, "gallery-dates.json");
  if (!fs.existsSync(datePath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(datePath, "utf8"));
  } catch (error) {
    return {};
  }
}

function listImagesWithDates(dir, dateMap) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((file) => IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()))
    .map((file) => {
      const dateValue = dateMap[file];
      const dateMs = typeof dateValue === "number" ? dateValue : 0;
      return { name: file, dateMs };
    })
    .sort((a, b) => {
      if (b.dateMs !== a.dateMs) {
        return b.dateMs - a.dateMs;
      }
      return a.name.localeCompare(b.name);
    });
}

module.exports = function () {
  const imagesDir = path.join(__dirname, "..", "images", "gallery");
  const optimizedDir = path.join(imagesDir, "optimized");
  const dateMap = loadDateMap();

  const sourceFiles = listImagesWithDates(imagesDir, dateMap);
  const optimizedFiles = listImagesWithDates(optimizedDir, dateMap);
  const optimizedSet = new Set(optimizedFiles.map((file) => file.name));

  return sourceFiles.map((file) => ({
    url: `${optimizedSet.has(file.name) ? "/images/gallery/optimized" : "/images/gallery"}/${file.name}`,
    alt: toAltText(file.name) || "Class fellowship photo"
  }));
};
