// أدوات مشتركة: تطبيع العناوين العربية لاكتشاف التكرار، والتواريخ بتوقيت القاهرة
const norm = s => String(s || "")
  .replace(/[ً-ْٰـ]/g, "")   // تشكيل وتطويل
  .replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
  .replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLowerCase();

const todayCairo = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());

const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + "T00:00:00Z")) &&
  new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { norm, todayCairo, isDate, HttpError, ah };
