export function normalizeStoredRating(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return 50;

  const rating = numericValue <= 10
    ? Math.round(50 + (numericValue / 10) * 50)
    : Math.round(numericValue);

  return Math.min(100, Math.max(50, rating));
}

export function clampRating(value) {
  return normalizeStoredRating(value);
}

export function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date not set";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

export function toDateTimeLocalValue(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 16);
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function getImageFromInput(input, fallback) {
  const file = input.files && input.files[0];
  if (!file) return Promise.resolve(fallback);

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.addEventListener("load", async () => {
      const resizedImage = await resizeImageDataUrl(reader.result);
      resolve(resizedImage || reader.result);
    });
    reader.addEventListener("error", () => {
      alert("That image could not be read. Please try another photo.");
      resolve(fallback);
    });
    reader.readAsDataURL(file);
  });
}

export function readFileAsDataUrl(file) {
  if (!file) return Promise.resolve("");
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(typeof reader.result === "string" ? reader.result : ""));
    reader.addEventListener("error", () => resolve(""));
    reader.readAsDataURL(file);
  });
}

export function resizeImageDataUrl(dataUrl) {
  return new Promise((resolve) => {
    const image = new Image();
    image.addEventListener("load", () => {
      const maxSize = 480;
      const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) {
        resolve(dataUrl);
        return;
      }
      canvas.width = width;
      canvas.height = height;
      context.drawImage(image, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    });
    image.addEventListener("error", () => resolve(""));
    image.src = dataUrl;
  });
}
