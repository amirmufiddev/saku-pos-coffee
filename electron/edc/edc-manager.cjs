var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// electron/edc/src/edc-manager.ts
var edc_manager_exports = {};
__export(edc_manager_exports, {
  EDCManager: () => EDCManager,
  edcManager: () => edcManager
});
module.exports = __toCommonJS(edc_manager_exports);
var import_serialport6 = require("serialport");
var net4 = __toESM(require("net"), 1);

// electron/edc/src/edc/edc-debit-credit.ts
var net = __toESM(require("net"), 1);
var import_serialport = require("serialport");

// electron/edc/src/edc/edc-protocol.ts
var DANAMON_AMOUNT_PREFIX = "10000000";
var DANAMON_AMOUNT_MAX_RUPIAH = 999999;
var VOID_PIPE_FIELD = {
  TERMINAL_ID: 0,
  REFERENCE: 1,
  CARD_TYPE: 2,
  MASKED_CARD: 3,
  ENTRY_MODE: 4,
  TRANSACTION_TYPE: 5,
  BATCH: 6,
  INVOICE: 7,
  DATE: 8,
  TIME: 9,
  RRN: 10,
  APPROVAL: 11,
  AMOUNT_OR_STATUS: 12
};
var LINK_CONTROL_BYTE_NAMES = {
  2: "STX",
  3: "ETX",
  4: "EOT",
  5: "ENQ",
  6: "ACK",
  21: "NAK"
};
var EMPTY_PARSED_FIELDS = {
  approvalCode: "",
  maskedCardNo: "",
  traceNumber: "",
  referenceNumber: "",
  rrn: "",
  terminalId: "",
  merchantId: "",
  cardType: "",
  merchantPan: "",
  issuerName: "",
  transactionStatus: "",
  entryMode: "",
  transactionType: "",
  batchNumber: "",
  invoiceSequence: "",
  transactionDate: "",
  transactionTime: "",
  customerName: "",
  customerPan: "",
  reffId: "",
  terminalAmount: "",
  inquiryFound: true,
  detail: ""
};
var QRIS_INQUIRY_PIPE_FIELD = {
  TERMINAL_ID: 0,
  MERCHANT_ID: 1,
  CARD_TYPE: 2,
  MERCHANT_PAN: 3,
  ISSUER_NAME: 4,
  TRANSACTION_TYPE: 5,
  TRANSACTION_STATUS: 6,
  REFERENCE_NUMBER: 7,
  DATE: 8,
  TIME: 9,
  CUSTOMER_NAME: 10,
  CUSTOMER_PAN: 11,
  REFF_ID: 12,
  AMOUNT: 13
};
function formatDanamonAmount(amount) {
  const rounded = Math.round(amount);
  const rupiah6 = rounded.toString().padStart(6, "0");
  return `${DANAMON_AMOUNT_PREFIX}${rupiah6}`;
}
function validateDanamonAmount(amount, paymentType) {
  const rounded = Math.round(amount);
  if (rounded <= 0) {
    return "Nominal pembayaran EDC harus lebih dari nol.";
  }
  if (paymentType !== "QRIS" && rounded > DANAMON_AMOUNT_MAX_RUPIAH) {
    return `Nominal EDC melebihi batas Danamon serial (maks Rp ${DANAMON_AMOUNT_MAX_RUPIAH.toLocaleString("id-ID")}).`;
  }
  return null;
}
function parseHexByteEnv(envValue, fallback) {
  if (!envValue) return fallback;
  const parsed = parseInt(envValue.trim(), 16);
  return Number.isNaN(parsed) || parsed < 0 || parsed > 255 ? fallback : parsed;
}
function mapEdcErrorMessage(respCode, detail) {
  if (respCode === "10" && detail.startsWith("ER")) {
    return "Terminal Axium DX8000 error (10-ER): app Danamon menerima frame serial tapi menolak transaksi ECR. Jika app Danamon force-close setelah bayar dari POS, hubungi Danamon/ICT \u2014 parameter integrasi ECR Serial belum benar di TMS.";
  }
  if (respCode === "10") {
    return "Terminal EDC menolak transaksi (kode 10). Cek konfigurasi merchant/tipe pembayaran di mesin.";
  }
  return `Pembayaran EDC Ditolak (Response Code: ${respCode}${detail ? ` / ${detail}` : ""})`;
}
function pickVoidPipeField(fields, index) {
  return fields[index]?.trim() ?? "";
}
function isQrisDanamonPayload(payload) {
  return payload.length >= 5 && payload[0] === 1 && payload[1] === 60;
}
function parseQrisDanamonResponse(payload) {
  const statusPrefix = payload.subarray(2, 5).toString("ascii");
  const tailAscii = payload.subarray(5).toString("ascii").replace(/\x03/g, "").trim();
  if (!tailAscii.includes("|")) {
    const isEr = statusPrefix.includes("ER") || tailAscii.includes("ER");
    return {
      respCode: "10",
      ...EMPTY_PARSED_FIELDS,
      detail: isEr ? "ER" : tailAscii
    };
  }
  const fields = tailAscii.split("|").map((field) => field.trim());
  const mapped = mapQrisPipeFields(fields);
  const statusLabel = mapped.transactionStatus.toUpperCase();
  const isSuccess = statusPrefix === "200" && statusLabel === "SUKSES";
  return {
    respCode: isSuccess ? "00" : "10",
    ...EMPTY_PARSED_FIELDS,
    ...mapped,
    detail: isSuccess ? "" : statusLabel || statusPrefix
  };
}
function isVoidDanamonPayload(payload) {
  const voidVersionByte = parseHexByteEnv(process.env.EDC_VOID_VERSION, 1);
  const voidTypeByte = parseHexByteEnv(process.env.EDC_VOID_TYPE, 50);
  const voidSubTypeByte = parseHexByteEnv(process.env.EDC_VOID_SUB_TYPE, 48);
  return payload.length >= 3 && payload[0] === voidVersionByte && payload[1] === voidTypeByte && payload[2] === voidSubTypeByte;
}
function isQrisInquiryDanamonPayload(payload) {
  const inquiryVersionByte = parseHexByteEnv(process.env.EDC_QRIS_INQUIRY_VERSION, 1);
  const lastTypeByte = parseHexByteEnv(process.env.EDC_QRIS_LAST_TYPE, 61);
  const lastSubTypeByte = parseHexByteEnv(process.env.EDC_QRIS_LAST_SUB_TYPE, 48);
  const anyTypeByte = parseHexByteEnv(process.env.EDC_QRIS_ANY_TYPE, 62);
  const anySubTypeByte = parseHexByteEnv(process.env.EDC_QRIS_ANY_SUB_TYPE, 48);
  return payload.length >= 3 && payload[0] === inquiryVersionByte && (payload[1] === lastTypeByte && payload[2] === lastSubTypeByte || payload[1] === anyTypeByte && payload[2] === anySubTypeByte);
}
function pickInquiryPipeField(fields, index) {
  return fields[index]?.trim() ?? "";
}
function mapQrisPipeFields(fields) {
  const idx = QRIS_INQUIRY_PIPE_FIELD;
  return {
    terminalId: pickInquiryPipeField(fields, idx.TERMINAL_ID),
    merchantId: pickInquiryPipeField(fields, idx.MERCHANT_ID),
    cardType: pickInquiryPipeField(fields, idx.CARD_TYPE),
    merchantPan: pickInquiryPipeField(fields, idx.MERCHANT_PAN),
    issuerName: pickInquiryPipeField(fields, idx.ISSUER_NAME),
    transactionType: pickInquiryPipeField(fields, idx.TRANSACTION_TYPE),
    transactionStatus: pickInquiryPipeField(fields, idx.TRANSACTION_STATUS),
    referenceNumber: pickInquiryPipeField(fields, idx.REFERENCE_NUMBER),
    traceNumber: pickInquiryPipeField(fields, idx.REFERENCE_NUMBER),
    transactionDate: pickInquiryPipeField(fields, idx.DATE),
    transactionTime: pickInquiryPipeField(fields, idx.TIME),
    customerName: pickInquiryPipeField(fields, idx.CUSTOMER_NAME),
    customerPan: pickInquiryPipeField(fields, idx.CUSTOMER_PAN),
    reffId: pickInquiryPipeField(fields, idx.REFF_ID),
    terminalAmount: pickInquiryPipeField(fields, idx.AMOUNT),
    maskedCardNo: pickInquiryPipeField(fields, idx.CUSTOMER_PAN) || pickInquiryPipeField(fields, idx.MERCHANT_PAN),
    approvalCode: "",
    rrn: pickInquiryPipeField(fields, idx.REFF_ID),
    entryMode: "",
    batchNumber: "",
    invoiceSequence: ""
  };
}
function evaluateQrisInquiryResult(fields, tailAscii) {
  const idx = QRIS_INQUIRY_PIPE_FIELD;
  const statusLabel = pickInquiryPipeField(fields, idx.TRANSACTION_STATUS).toUpperCase();
  const joinedUpper = (fields.length > 0 ? fields.join("|") : tailAscii).toUpperCase();
  const notFoundKeywords = ["TIDAK DITEMUKAN", "NOT FOUND", "NO RECORD", "NO TRANSACTION"];
  if (notFoundKeywords.some((keyword) => joinedUpper.includes(keyword))) {
    return {
      isSuccess: false,
      respCode: "99",
      inquiryFound: false,
      detail: "Transaksi QRIS tidak ditemukan di EDC"
    };
  }
  const errorKeywords = ["GAGAL", "FAILED", "FAIL", "REJECT", "DECLINE", "ERROR", "TOLAK", "DITOLAK"];
  if (errorKeywords.some((keyword) => joinedUpper.includes(keyword) || statusLabel.includes(keyword))) {
    return {
      isSuccess: false,
      respCode: "10",
      inquiryFound: true,
      detail: statusLabel || "Inquiry QRIS gagal"
    };
  }
  const successKeywords = ["SUKSES", "SUCCESS", "APPROVED", "BERHASIL", "COMPLETE", "OK"];
  if (successKeywords.some((keyword) => joinedUpper.includes(keyword) || statusLabel.includes(keyword))) {
    return { isSuccess: true, respCode: "00", inquiryFound: true, detail: "" };
  }
  const referenceNumber = pickInquiryPipeField(fields, idx.REFERENCE_NUMBER);
  const amount = pickInquiryPipeField(fields, idx.AMOUNT);
  if (referenceNumber && amount) {
    return { isSuccess: true, respCode: "00", inquiryFound: true, detail: "" };
  }
  return {
    isSuccess: false,
    respCode: "10",
    inquiryFound: true,
    detail: statusLabel || tailAscii || "Status inquiry QRIS tidak dikenali"
  };
}
function parseQrisInquiryDanamonResponse(payload) {
  const remainder = payload.subarray(3);
  const tailAscii = remainder.toString("ascii").replace(/\x03/g, "").trim();
  if (!tailAscii.includes("|")) {
    const result2 = evaluateQrisInquiryResult([], tailAscii);
    return {
      respCode: result2.respCode,
      ...EMPTY_PARSED_FIELDS,
      inquiryFound: result2.inquiryFound,
      detail: result2.detail
    };
  }
  let offset = 0;
  if (remainder.length >= 2 && remainder.subarray(0, 2).toString("ascii") === "10") {
    offset = 2;
  }
  const pipeAscii = remainder.subarray(offset).toString("ascii").replace(/\x03/g, "").trim();
  const fields = pipeAscii.split("|").map((field) => field.trim());
  const result = evaluateQrisInquiryResult(fields, pipeAscii);
  return {
    respCode: result.respCode,
    ...EMPTY_PARSED_FIELDS,
    ...mapQrisPipeFields(fields),
    inquiryFound: result.inquiryFound,
    detail: result.detail
  };
}
function isSettleDanamonPayload(payload) {
  const settleVersionByte = parseHexByteEnv(process.env.EDC_SETTLE_VERSION, 1);
  const settleTypeByte = parseHexByteEnv(process.env.EDC_SETTLE_TYPE, 51);
  const settleSubTypeByte = parseHexByteEnv(process.env.EDC_SETTLE_SUB_TYPE, 48);
  return payload.length >= 3 && payload[0] === settleVersionByte && payload[1] === settleTypeByte && payload[2] === settleSubTypeByte;
}
function evaluateSettleDanamonResult(fields, tailAscii) {
  const joinedUpper = (fields.length > 0 ? fields.join("|") : tailAscii).toUpperCase();
  const errorKeywords = [
    "GAGAL",
    "FAILED",
    "FAIL",
    "REJECT",
    "DECLINE",
    "ERROR",
    "TOLAK",
    "DITOLAK",
    "NO BATCH",
    "EMPTY BATCH"
  ];
  if (errorKeywords.some((keyword) => joinedUpper.includes(keyword))) {
    return {
      isSuccess: false,
      respCode: "10",
      detail: fields[fields.length - 1]?.trim() || tailAscii || "Settlement ditolak terminal"
    };
  }
  const successKeywords = [
    "SUKSES",
    "SUCCESS",
    "SETTLE",
    "SETTLEMENT",
    "BERHASIL",
    "BATCH CLOSE",
    "CLOSE BATCH",
    "SETTLE OK"
  ];
  if (successKeywords.some((keyword) => joinedUpper.includes(keyword))) {
    return { isSuccess: true, respCode: "00", detail: "" };
  }
  return {
    isSuccess: false,
    respCode: "10",
    detail: tailAscii || "Settlement belum terkonfirmasi sukses"
  };
}
function parseSettleDanamonResponse(payload) {
  const remainder = payload.subarray(3);
  const tailAscii = remainder.toString("ascii").replace(/\x03/g, "").trim();
  if (!tailAscii.includes("|")) {
    const isShortErError = /^ER\d{0,4}$/i.test(tailAscii);
    const result2 = evaluateSettleDanamonResult([], tailAscii);
    if (result2.isSuccess) {
      return { respCode: "00", ...EMPTY_PARSED_FIELDS, detail: "" };
    }
    return {
      respCode: isShortErError ? "10" : result2.respCode,
      ...EMPTY_PARSED_FIELDS,
      detail: isShortErError ? "ER" : result2.detail
    };
  }
  let offset = 0;
  if (remainder.length >= 2 && remainder.subarray(0, 2).toString("ascii") === "10") {
    offset = 2;
  }
  const respCode = remainder.length >= offset + 2 ? remainder.subarray(offset, offset + 2).toString("ascii") : "99";
  const pipeAscii = remainder.subarray(offset + 2).toString("ascii").replace(/\x03/g, "").trim();
  const fields = pipeAscii.split("|").map((field) => field.trim());
  const result = evaluateSettleDanamonResult(fields, pipeAscii);
  if (respCode === "00") {
    return {
      respCode: "00",
      ...EMPTY_PARSED_FIELDS,
      terminalId: fields[0] ?? "",
      referenceNumber: fields[1] ?? "",
      transactionType: fields[5] ?? "SETTLEMENT",
      batchNumber: fields[6] ?? "",
      transactionDate: fields[8] ?? "",
      transactionTime: fields[9] ?? "",
      terminalAmount: fields[12] ?? "",
      detail: ""
    };
  }
  return {
    respCode: result.respCode,
    ...EMPTY_PARSED_FIELDS,
    terminalId: fields[0] ?? "",
    referenceNumber: fields[1] ?? "",
    transactionType: fields[5] ?? "SETTLEMENT",
    batchNumber: fields[6] ?? "",
    transactionDate: fields[8] ?? "",
    transactionTime: fields[9] ?? "",
    terminalAmount: fields[12] ?? "",
    detail: result.detail
  };
}
function evaluateVoidDanamonResult(fields) {
  const idx = VOID_PIPE_FIELD;
  const transactionType = pickVoidPipeField(fields, idx.TRANSACTION_TYPE).toUpperCase();
  const approvalCode = pickVoidPipeField(fields, idx.APPROVAL);
  const rrn = pickVoidPipeField(fields, idx.RRN);
  const terminalAmount = pickVoidPipeField(fields, idx.AMOUNT_OR_STATUS);
  const transactionDate = pickVoidPipeField(fields, idx.DATE);
  const transactionTime = pickVoidPipeField(fields, idx.TIME);
  const joinedUpper = fields.join("|").toUpperCase();
  const errorKeywords = [
    "GAGAL",
    "FAILED",
    "FAIL",
    "REJECT",
    "DECLINE",
    "NO RECORD",
    "NOT FOUND",
    "TIDAK DITEMUKAN",
    "ERROR",
    "TOLAK",
    "DITOLAK"
  ];
  if (errorKeywords.some((keyword) => joinedUpper.includes(keyword))) {
    return {
      isSuccess: false,
      respCode: "10",
      detail: terminalAmount || transactionType || "VOID ditolak terminal"
    };
  }
  const successKeywords = ["SUKSES", "SUCCESS", "APPROVED", "BERHASIL", "COMPLETE", "OK"];
  if (successKeywords.some((keyword) => joinedUpper.includes(keyword))) {
    return { isSuccess: true, respCode: "00", detail: "" };
  }
  const hasApproval = /^\d{4,8}$/.test(approvalCode);
  const hasRrn = rrn.replace(/\D/g, "").length >= 6;
  const hasPositiveAmount = terminalAmount.length > 0 && terminalAmount !== "0" && !/^0+$/.test(terminalAmount);
  const hasDateTime = Boolean(transactionDate && transactionTime);
  const isVoidOperation = transactionType.includes("VOID");
  if (terminalAmount === "0" && !hasApproval && !hasRrn) {
    return {
      isSuccess: false,
      respCode: "10",
      detail: "VOID gagal \u2014 status/amount terminal=0 (trace/nominal tidak cocok atau transaksi tidak ditemukan)"
    };
  }
  if (isVoidOperation && hasDateTime && (hasApproval || hasRrn || hasPositiveAmount)) {
    return { isSuccess: true, respCode: "00", detail: "" };
  }
  if (isVoidOperation) {
    return {
      isSuccess: false,
      respCode: "10",
      detail: "VOID belum terkonfirmasi sukses \u2014 respons terminal tidak memuat approval/RRN/nominal valid"
    };
  }
  return {
    isSuccess: false,
    respCode: "10",
    detail: transactionType || joinedUpper || "Format respons VOID tidak dikenali"
  };
}
function parseVoidDanamonResponse(payload) {
  const tailAscii = payload.subarray(3).toString("ascii").replace(/\x03/g, "").trim();
  if (!tailAscii.includes("|")) {
    const isShortErError = /^ER\d{0,4}$/i.test(tailAscii);
    return {
      respCode: isShortErError ? "10" : "99",
      ...EMPTY_PARSED_FIELDS,
      detail: isShortErError ? "ER" : tailAscii
    };
  }
  const fields = tailAscii.split("|").map((field) => field.trim());
  const idx = VOID_PIPE_FIELD;
  const result = evaluateVoidDanamonResult(fields);
  return {
    respCode: result.respCode,
    ...EMPTY_PARSED_FIELDS,
    terminalId: pickVoidPipeField(fields, idx.TERMINAL_ID),
    referenceNumber: pickVoidPipeField(fields, idx.REFERENCE),
    traceNumber: pickVoidPipeField(fields, idx.REFERENCE),
    cardType: pickVoidPipeField(fields, idx.CARD_TYPE),
    maskedCardNo: pickVoidPipeField(fields, idx.MASKED_CARD),
    entryMode: pickVoidPipeField(fields, idx.ENTRY_MODE),
    transactionType: pickVoidPipeField(fields, idx.TRANSACTION_TYPE),
    batchNumber: pickVoidPipeField(fields, idx.BATCH),
    invoiceSequence: pickVoidPipeField(fields, idx.INVOICE),
    transactionDate: pickVoidPipeField(fields, idx.DATE),
    transactionTime: pickVoidPipeField(fields, idx.TIME),
    rrn: pickVoidPipeField(fields, idx.RRN),
    approvalCode: pickVoidPipeField(fields, idx.APPROVAL),
    terminalAmount: pickVoidPipeField(fields, idx.AMOUNT_OR_STATUS),
    detail: result.detail
  };
}
function parseDirectResponse(payload) {
  if (payload.length < 3) {
    return { respCode: "99", ...EMPTY_PARSED_FIELDS, detail: payload.toString("ascii") };
  }
  if (isQrisDanamonPayload(payload)) {
    return parseQrisDanamonResponse(payload);
  }
  if (isQrisInquiryDanamonPayload(payload)) {
    return parseQrisInquiryDanamonResponse(payload);
  }
  if (isVoidDanamonPayload(payload)) {
    return parseVoidDanamonResponse(payload);
  }
  if (isSettleDanamonPayload(payload)) {
    return parseSettleDanamonResponse(payload);
  }
  const transCodeLen = payload[0] < 32 ? 1 : 2;
  let dataOffset = transCodeLen;
  const hasDanamonHeader = payload.length >= dataOffset + 2 && payload.subarray(dataOffset, dataOffset + 2).toString("ascii") === "10";
  if (hasDanamonHeader) {
    dataOffset += 2;
  }
  const respCode = payload.length >= dataOffset + 2 ? payload.subarray(dataOffset, dataOffset + 2).toString("ascii") : "99";
  const tail = payload.subarray(dataOffset + 2);
  const tailAscii = tail.toString("ascii").replace(/\x03/g, "").trim();
  if (respCode === "ER" || tailAscii.startsWith("ER") && !tailAscii.includes("|")) {
    return { respCode: "10", ...EMPTY_PARSED_FIELDS, detail: "ER" };
  }
  if (respCode === "00" && tailAscii.includes("|")) {
    const fields = tailAscii.split("|").map((field) => field.trim());
    return {
      respCode: "00",
      ...EMPTY_PARSED_FIELDS,
      terminalId: fields[0] ?? "",
      referenceNumber: fields[1] ?? "",
      cardType: fields[2] ?? "",
      maskedCardNo: fields[3] ?? "",
      entryMode: fields[4] ?? "",
      transactionType: fields[5] ?? "",
      batchNumber: fields[6] ?? "",
      traceNumber: fields[7] ?? "",
      transactionDate: fields[8] ?? "",
      transactionTime: fields[9] ?? "",
      rrn: fields[10] ?? "",
      approvalCode: fields[11] ?? "",
      terminalAmount: fields[12] ?? "",
      invoiceSequence: fields[7] ?? "",
      detail: ""
    };
  }
  if (tail.length >= 28) {
    const traceNumber = tail.subarray(22, 28).toString("ascii").trim();
    return {
      respCode,
      ...EMPTY_PARSED_FIELDS,
      approvalCode: tail.subarray(0, 6).toString("ascii").trim(),
      maskedCardNo: tail.subarray(6, 22).toString("ascii").trim(),
      traceNumber,
      referenceNumber: traceNumber,
      detail: ""
    };
  }
  return { respCode, ...EMPTY_PARSED_FIELDS, detail: tailAscii };
}
function isShortTerminalError(payload) {
  return payload.length <= 7 && payload.toString("ascii").includes("ER");
}
function isEdcLinkNak(buffer) {
  if (buffer.length === 1 && buffer[0] === 21) return true;
  return buffer.length >= 3 && buffer[0] === 21 && buffer[1] === 3;
}
function formatLinkByteTrace(buffer) {
  return [...buffer].map((byte) => {
    const label = LINK_CONTROL_BYTE_NAMES[byte];
    return label ? `${label}(0x${byte.toString(16).toUpperCase().padStart(2, "0")})` : `0x${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }).join(" ");
}
function classifyLinkChunk(buffer) {
  if (buffer.length === 0) return "EMPTY";
  if (isEdcLinkNak(buffer)) return "NAK";
  if (buffer.length === 1) return LINK_CONTROL_BYTE_NAMES[buffer[0]] ?? "DATA_1B";
  if (buffer.includes(2) && buffer.includes(3)) return "STX_FRAME";
  if (buffer.includes(5)) return "ENQ";
  return "DATA_MULTI";
}
function writeLinkAck(port, context) {
  console.log(`[EDC Manager] Kirim ACK (0x06) ke EDC (${context})`);
  port?.write(Buffer.from([6]));
}
function buildStxLrcFrame(bodyBuf) {
  let lrcByte = 0;
  for (let i = 0; i < bodyBuf.length; i++) {
    lrcByte ^= bodyBuf[i];
  }
  return Buffer.concat([Buffer.from([2]), bodyBuf, Buffer.from([lrcByte])]);
}
function normalizeSerialPortPath(portPath) {
  const trimmed = (portPath || "").trim();
  if (!trimmed) return "";
  if (process.platform === "darwin") {
    if (trimmed.startsWith("/dev/tty.")) {
      return trimmed.replace("/dev/tty.", "/dev/cu.");
    }
    return trimmed;
  }
  if (process.platform === "win32") {
    const m = trimmed.match(/^(\\\\\.\\)?(COM\d+)$/i);
    if (m) {
      const num = parseInt(m[2].substring(3), 10);
      if (num >= 10) {
        return `\\\\.\\COM${num}`;
      }
      return `COM${num}`;
    }
    return trimmed.toUpperCase();
  }
  return trimmed;
}
function arePortPathsEquivalent(pathA, pathB) {
  if (!pathA || !pathB) return false;
  const normA = normalizeSerialPortPath(pathA);
  const normB = normalizeSerialPortPath(pathB);
  if (process.platform === "win32") {
    return normA.toLowerCase() === normB.toLowerCase();
  }
  return normA === normB;
}
function getDefaultBaudRate() {
  if (process.env.EDC_BAUD_RATE) {
    const parsed = parseInt(process.env.EDC_BAUD_RATE, 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 115200;
}
function getDefaultEdcTimeoutMs() {
  if (process.env.EDC_TRANSACTION_TIMEOUT_MS) {
    const parsed = parseInt(process.env.EDC_TRANSACTION_TIMEOUT_MS, 10);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  return 18e4;
}
function getPreSendDelayMs() {
  const parsed = parseInt(process.env.EDC_PRE_SEND_DELAY_MS || "1500", 10);
  return Number.isNaN(parsed) ? 1500 : parsed;
}
function paymentResponseFromParsed(parsed, isSuccess, rawHex, successMessage) {
  return {
    success: isSuccess,
    responseCode: parsed.respCode,
    referenceNumber: parsed.referenceNumber || void 0,
    approvalCode: parsed.approvalCode || void 0,
    maskedCardNo: parsed.maskedCardNo || void 0,
    traceNumber: parsed.traceNumber || void 0,
    rrn: parsed.rrn || void 0,
    terminalId: parsed.terminalId || void 0,
    merchantId: parsed.merchantId || void 0,
    cardType: parsed.cardType || void 0,
    merchantPan: parsed.merchantPan || void 0,
    issuerName: parsed.issuerName || void 0,
    transactionStatus: parsed.transactionStatus || void 0,
    entryMode: parsed.entryMode || void 0,
    transactionType: parsed.transactionType || void 0,
    batchNumber: parsed.batchNumber || void 0,
    invoiceSequence: parsed.invoiceSequence || void 0,
    transactionDate: parsed.transactionDate || void 0,
    transactionTime: parsed.transactionTime || void 0,
    customerName: parsed.customerName || void 0,
    customerPan: parsed.customerPan || void 0,
    reffId: parsed.reffId || void 0,
    terminalAmount: parsed.terminalAmount || void 0,
    inquiryFound: parsed.inquiryFound,
    message: isSuccess ? successMessage : mapEdcErrorMessage(parsed.respCode, parsed.detail),
    rawHexResponse: rawHex
  };
}
function extractTerminalIdFromPayload(data) {
  const ascii = data.toString("ascii").replace(/\x03/g, "").trim();
  if (ascii.includes("|")) {
    return ascii.split("|")[0]?.trim() || void 0;
  }
  return void 0;
}
function logRxChunk(chunk) {
  console.log("\n[EDC Manager] Data diterima dari EDC");
  console.log(`              Hex   : ${chunk.toString("hex").toUpperCase()}`);
  console.log(
    `              ASCII : ${chunk.toString("ascii").replace(/[\x00-\x1F\x7F]/g, (m) => `<${m.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}>`)}`
  );
}
function isBufferNak(bufferAccumulator) {
  return bufferAccumulator.length === 1 && bufferAccumulator[0] === 21 || bufferAccumulator.length >= 3 && bufferAccumulator[0] === 21 && bufferAccumulator[1] === 3;
}

// electron/edc/src/edc/edc-debit-credit.ts
function buildDebitCreditPaymentFrame(paymentType, amount) {
  const ETX2 = 3;
  const transCodeByte = 1;
  const amountStr = formatDanamonAmount(amount);
  console.log("===========================================================");
  console.log(`              ${paymentType} PAYMENT FRAME (ECR)              `);
  console.log("===========================================================");
  console.log(`  Payment Type     : ${paymentType}`);
  console.log(`  Amount (Rp)      : ${amount.toLocaleString("id-ID")}`);
  console.log(`  Amount Field     : ${amountStr} (14 digit: "8+6" ASCII)`);
  console.log("-----------------------------------------------------------");
  console.log(`    STX            : 0x02`);
  console.log(`    Trans Code     : 0x${transCodeByte.toString(16).toUpperCase().padStart(2, "0")}`);
  console.log(`    Amount         : ${amountStr}`);
  console.log(`    ETX            : 0x${ETX2.toString(16).toUpperCase().padStart(2, "0")}`);
  console.log("-----------------------------------------------------------");
  const bodyBuf = Buffer.concat([Buffer.from([transCodeByte]), Buffer.from(amountStr, "ascii"), Buffer.from([ETX2])]);
  const finalFrame = buildStxLrcFrame(bodyBuf);
  console.log(
    `  LRC/CRC          : 0x${finalFrame[finalFrame.length - 1].toString(16).toUpperCase().padStart(2, "0")}`
  );
  console.log(`  Complete Frame   : ${finalFrame.toString("hex").toUpperCase()}`);
  console.log("===========================================================\n");
  return finalFrame;
}
function processDebitCreditPaymentTcp(params) {
  const ip = params.ipTerminal?.trim();
  const port = params.port;
  const { amount, paymentType, timeoutMs = getDefaultEdcTimeoutMs() } = params;
  if (paymentType !== "DEBIT" && paymentType !== "CREDIT") {
    return Promise.resolve({ success: false, message: "Tipe pembayaran tidak valid untuk modul debit/kredit." });
  }
  if (!ip || !port) {
    return Promise.resolve({
      success: false,
      message: "IP Terminal dan Port wajib untuk pembayaran EDC TCP/IP."
    });
  }
  const amountError = validateDanamonAmount(amount, paymentType);
  if (amountError) {
    return Promise.resolve({ success: false, message: amountError });
  }
  return new Promise((resolve) => {
    let settled = false;
    let bufferAccumulator = Buffer.alloc(0);
    const client = net.createConnection({ host: ip, port });
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try {
        client.destroy();
      } catch (_) {
      }
      resolve(result);
    };
    const timer = setTimeout(() => {
      finish({
        success: false,
        message: `Waktu transaksi di EDC habis (Timeout ${timeoutMs / 1e3}s). Pembayaran dibatalkan.`
      });
    }, timeoutMs);
    client.setTimeout(timeoutMs);
    client.on("connect", () => {
      const frame = buildDebitCreditPaymentFrame(paymentType, amount);
      setTimeout(() => client.write(frame), 300);
    });
    client.on("data", (chunk) => {
      bufferAccumulator = Buffer.concat([bufferAccumulator, chunk]);
      const stxIdx = bufferAccumulator.indexOf(2);
      const etxIdx = bufferAccumulator.lastIndexOf(3);
      if (stxIdx === -1 || etxIdx === -1 || etxIdx <= stxIdx) return;
      if (bufferAccumulator.length < etxIdx + 2) return;
      clearTimeout(timer);
      const payload = bufferAccumulator.subarray(stxIdx + 1, etxIdx);
      const parsed = parseDirectResponse(payload);
      finish(
        paymentResponseFromParsed(
          parsed,
          parsed.respCode === "00",
          bufferAccumulator.toString("hex"),
          "Pembayaran EDC Berhasil"
        )
      );
    });
    client.on("timeout", () => {
      clearTimeout(timer);
      finish({ success: false, message: `Timeout: Unable to connect to ${ip}:${port}` });
    });
    client.on("error", (err) => {
      clearTimeout(timer);
      finish({ success: false, message: `Koneksi TCP EDC error: ${err.message}` });
    });
  });
}
function processDebitCreditPaymentSerial(host, params) {
  const paymentType = params.paymentType;
  if (paymentType !== "DEBIT" && paymentType !== "CREDIT") {
    return Promise.resolve({ success: false, message: "Tipe pembayaran tidak valid untuk modul debit/kredit." });
  }
  let { portPath, amount, baudRate = getDefaultBaudRate(), timeoutMs = getDefaultEdcTimeoutMs() } = params;
  portPath = normalizeSerialPortPath(portPath);
  const amountError = validateDanamonAmount(amount, paymentType);
  if (amountError) {
    return Promise.resolve({ success: false, message: amountError });
  }
  return new Promise((resolve) => {
    let isSettled = false;
    let bufferAccumulator = Buffer.alloc(0);
    let saleFrameSent = false;
    let awaitingPaymentResult = false;
    console.log("\n+-----------------------------------------------------------+");
    console.log(`|          MEMULAI TRANSAKSI EDC - ${paymentType.padEnd(6, " ")}              |`);
    console.log("+-----------------------------------------------------------+");
    console.log(`[EDC ${paymentType}] Amount        : Rp ${amount.toLocaleString("id-ID")}`);
    console.log(`[EDC ${paymentType}] Serial Port   : ${portPath}`);
    console.log(`[EDC ${paymentType}] Baud Rate     : ${baudRate}
`);
    let activePort;
    try {
      const portOptions = {
        path: portPath,
        baudRate,
        dataBits: 8,
        parity: "none",
        stopBits: 1,
        autoOpen: false
      };
      activePort = host.createPort ? host.createPort(portOptions) : new import_serialport.SerialPort(portOptions);
      host.setActivePort(activePort);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Gagal inisialisasi port";
      return resolve({ success: false, message: `Gagal menginisialisasi Serial Port (${portPath}): ${message}` });
    }
    const timer = setTimeout(() => {
      if (!isSettled) {
        isSettled = true;
        if (awaitingPaymentResult) {
          host.markRecoveryRequired?.({
            reason: `Waktu transaksi di EDC habis (Timeout ${timeoutMs / 1e3}s) saat menunggu respons pembayaran`,
            amount,
            paymentType,
            portPath
          });
          host.cleanup(activePort);
          return resolve({
            success: false,
            responseCode: "RECOVERY_REQUIRED",
            message: `Waktu transaksi di EDC habis setelah request dikirim. Status transaksi ambigu di EDC \u2014 Lakukan pengecekan fisik/inquiry.`
          });
        }
        host.cleanup(activePort);
        resolve({
          success: false,
          message: `Waktu transaksi di EDC habis (Timeout ${timeoutMs / 1e3}s). Pembayaran dibatalkan.`
        });
      }
    }, timeoutMs);
    const finish = (result) => {
      if (!isSettled) {
        isSettled = true;
        clearTimeout(timer);
        host.cleanup(activePort);
        resolve(result);
      }
    };
    const sendFrame = () => {
      if (saleFrameSent || !host.getActivePort()?.isOpen) return;
      saleFrameSent = true;
      const frame = buildDebitCreditPaymentFrame(paymentType, amount);
      console.log(`[EDC ${paymentType}] Mengirim frame ke EDC terminal...`);
      host.getActivePort().write(frame);
    };
    activePort.open((openErr) => {
      if (openErr) {
        return finish({
          success: false,
          message: `Tidak dapat membuka Serial Port EDC (${portPath}): ${openErr.message}`
        });
      }
      try {
        activePort.set({ dtr: true, rts: true });
      } catch (_) {
      }
      activePort.on("data", (chunk) => {
        bufferAccumulator = Buffer.concat([bufferAccumulator, chunk]);
        logRxChunk(chunk);
        if (chunk.includes(5)) {
          console.log(`[EDC ${paymentType}] Menerima ENQ \u2014 balas ACK`);
          host.getActivePort()?.write(Buffer.from([6]));
          if (!saleFrameSent) setTimeout(() => sendFrame(), 100);
        }
        if (bufferAccumulator.length === 1 && bufferAccumulator[0] === 4) {
          bufferAccumulator = Buffer.alloc(0);
          return;
        }
        if (bufferAccumulator.length === 1 && bufferAccumulator[0] === 6) {
          if (saleFrameSent) {
            console.log(`[EDC ${paymentType}] Menunggu pelanggan tap/gesek/insert kartu...`);
            awaitingPaymentResult = true;
          } else {
            sendFrame();
          }
          bufferAccumulator = Buffer.alloc(0);
          return;
        }
        if (isBufferNak(bufferAccumulator)) {
          if (awaitingPaymentResult) {
            bufferAccumulator = Buffer.alloc(0);
            return finish({ success: false, responseCode: "10", message: mapEdcErrorMessage("10", "ER") });
          }
          return finish({
            success: false,
            message: "EDC menolak paket data (NAK - Format/LRC Salah)",
            rawHexResponse: bufferAccumulator.toString("hex")
          });
        }
        if (bufferAccumulator[0] === 6 && bufferAccumulator.length > 1) {
          if (saleFrameSent) awaitingPaymentResult = true;
          bufferAccumulator = bufferAccumulator.subarray(1);
        }
        const stxIdx = bufferAccumulator.indexOf(2);
        const etxIdx = bufferAccumulator.lastIndexOf(3);
        if (stxIdx === -1 || etxIdx === -1 || etxIdx <= stxIdx) return;
        if (bufferAccumulator.length < etxIdx + 2) return;
        if (saleFrameSent && !awaitingPaymentResult) return;
        const fullFrame = bufferAccumulator.subarray(stxIdx, etxIdx + 2);
        const payload = bufferAccumulator.subarray(stxIdx + 1, etxIdx);
        const parsed = parseDirectResponse(payload);
        if (isShortTerminalError(payload) && parsed.respCode === "10" && parsed.detail.startsWith("ER")) {
          return finish({
            success: false,
            responseCode: "10",
            message: mapEdcErrorMessage(parsed.respCode, parsed.detail),
            rawHexResponse: fullFrame.toString("hex")
          });
        }
        writeLinkAck(host.getActivePort(), `${paymentType} resp ${parsed.respCode}`);
        const isSuccess = parsed.respCode === "00";
        return finish(
          paymentResponseFromParsed(parsed, isSuccess, fullFrame.toString("hex"), "Pembayaran EDC Berhasil")
        );
      });
      activePort.on("error", (err) => {
        if (awaitingPaymentResult) {
          host.markRecoveryRequired?.({
            reason: `Koneksi serial EDC error saat menunggu hasil transaksi: ${err.message}`,
            amount,
            paymentType,
            portPath,
            lastError: err.message
          });
          return finish({
            success: false,
            responseCode: "RECOVERY_REQUIRED",
            message: `Koneksi Serial EDC Error setelah request dikirim (${err.message}). Status ambigu di EDC \u2014 Wajib recovery / cek struk EDC fisik.`
          });
        }
        finish({ success: false, message: `Koneksi Serial EDC Error: ${err.message}` });
      });
      activePort.on("close", () => {
        if (!isSettled) {
          if (awaitingPaymentResult) {
            host.markRecoveryRequired?.({
              reason: "Port serial EDC terputus saat menunggu respons transaksi (close event)",
              amount,
              paymentType,
              portPath
            });
            return finish({
              success: false,
              responseCode: "RECOVERY_REQUIRED",
              message: "Port serial EDC terputus setelah request pembayaran dikirim. Status transaksi ambigu di EDC \u2014 Wajib recovery / cek struk EDC fisik."
            });
          }
          finish({
            success: false,
            message: "Port serial EDC terputus. Tutup script test, lalu coba bayar lagi di POS."
          });
        }
      });
      setTimeout(() => sendFrame(), getPreSendDelayMs());
    });
  });
}
function processDebitCreditPayment(host, params) {
  if (params.connectionType === "TCP_IP") {
    return processDebitCreditPaymentTcp(params);
  }
  const portPath = params.portPath?.trim();
  if (!portPath) {
    return Promise.resolve({
      success: false,
      message: "Port serial EDC belum dikonfigurasi. Buka Pengaturan \u2192 EDC Configuration."
    });
  }
  return processDebitCreditPaymentSerial(host, { ...params, portPath });
}

// electron/edc/src/edc/edc-qris.ts
var net2 = __toESM(require("net"), 1);
var import_serialport2 = require("serialport");
function buildQrisPaymentFrame(amount) {
  const ETX2 = 3;
  const qrisVersionByte = parseHexByteEnv(process.env.EDC_QRIS_VERSION, 1);
  const qrisTypeByte = parseHexByteEnv(process.env.EDC_QRIS_TYPE, 60);
  const qrisSubTypeByte = parseHexByteEnv(process.env.EDC_QRIS_SUB_TYPE, 48);
  const headerBuf = Buffer.from([qrisVersionByte, qrisTypeByte, qrisSubTypeByte]);
  const amountStr = Math.round(amount).toString().padStart(12, "0");
  console.log("===========================================================");
  console.log("                    QRIS PAYMENT FRAME                    ");
  console.log("===========================================================");
  console.log(`  Payment Type     : QRIS`);
  console.log(`  Amount (Rp)      : ${amount.toLocaleString("id-ID")}`);
  console.log(`  Amount Field     : ${amountStr} (12 digit ASCII)`);
  console.log("-----------------------------------------------------------");
  console.log(`    STX            : 0x02`);
  console.log(`    Version        : 0x${qrisVersionByte.toString(16).toUpperCase().padStart(2, "0")}`);
  console.log(`    Type           : 0x${qrisTypeByte.toString(16).toUpperCase().padStart(2, "0")}`);
  console.log(`    SubType        : 0x${qrisSubTypeByte.toString(16).toUpperCase().padStart(2, "0")}`);
  console.log(`    Amount         : ${amountStr}`);
  console.log(`    ETX            : 0x${ETX2.toString(16).toUpperCase().padStart(2, "0")}`);
  console.log("-----------------------------------------------------------");
  const bodyBuf = Buffer.concat([headerBuf, Buffer.from(amountStr, "ascii"), Buffer.from([ETX2])]);
  const finalFrame = buildStxLrcFrame(bodyBuf);
  console.log(
    `  LRC/CRC          : 0x${finalFrame[finalFrame.length - 1].toString(16).toUpperCase().padStart(2, "0")}`
  );
  console.log(`  Complete Frame   : ${finalFrame.toString("hex").toUpperCase()}`);
  console.log("===========================================================\n");
  return finalFrame;
}
function processQrisPaymentTcp(params) {
  const ip = params.ipTerminal?.trim();
  const port = params.port;
  const { amount, timeoutMs = getDefaultEdcTimeoutMs() } = params;
  if (!ip || !port) {
    return Promise.resolve({
      success: false,
      message: "IP Terminal dan Port wajib untuk pembayaran EDC TCP/IP."
    });
  }
  const amountError = validateDanamonAmount(amount, "QRIS");
  if (amountError) {
    return Promise.resolve({ success: false, message: amountError });
  }
  return new Promise((resolve) => {
    let settled = false;
    let bufferAccumulator = Buffer.alloc(0);
    const client = net2.createConnection({ host: ip, port });
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try {
        client.destroy();
      } catch (_) {
      }
      resolve(result);
    };
    const timer = setTimeout(() => {
      finish({
        success: false,
        message: `Waktu transaksi di EDC habis (Timeout ${timeoutMs / 1e3}s). Pembayaran dibatalkan.`
      });
    }, timeoutMs);
    client.setTimeout(timeoutMs);
    client.on("connect", () => {
      const frame = buildQrisPaymentFrame(amount);
      setTimeout(() => client.write(frame), 300);
    });
    client.on("data", (chunk) => {
      bufferAccumulator = Buffer.concat([bufferAccumulator, chunk]);
      const stxIdx = bufferAccumulator.indexOf(2);
      const etxIdx = bufferAccumulator.lastIndexOf(3);
      if (stxIdx === -1 || etxIdx === -1 || etxIdx <= stxIdx) return;
      if (bufferAccumulator.length < etxIdx + 2) return;
      clearTimeout(timer);
      const payload = bufferAccumulator.subarray(stxIdx + 1, etxIdx);
      const parsed = parseDirectResponse(payload);
      finish(
        paymentResponseFromParsed(
          parsed,
          parsed.respCode === "00",
          bufferAccumulator.toString("hex"),
          "Pembayaran EDC Berhasil"
        )
      );
    });
    client.on("timeout", () => {
      clearTimeout(timer);
      finish({ success: false, message: `Timeout: Unable to connect to ${ip}:${port}` });
    });
    client.on("error", (err) => {
      clearTimeout(timer);
      finish({ success: false, message: `Koneksi TCP EDC error: ${err.message}` });
    });
  });
}
function processQrisPaymentSerial(host, params) {
  let { portPath, amount, baudRate = getDefaultBaudRate(), timeoutMs = getDefaultEdcTimeoutMs() } = params;
  portPath = normalizeSerialPortPath(portPath);
  const amountError = validateDanamonAmount(amount, "QRIS");
  if (amountError) {
    return Promise.resolve({ success: false, message: amountError });
  }
  return new Promise((resolve) => {
    let isSettled = false;
    let bufferAccumulator = Buffer.alloc(0);
    let saleFrameSent = false;
    let awaitingPaymentResult = false;
    console.log("\n+-----------------------------------------------------------+");
    console.log("|          MEMULAI TRANSAKSI EDC - QRIS                   |");
    console.log("+-----------------------------------------------------------+");
    console.log(`[EDC QRIS] Amount        : Rp ${amount.toLocaleString("id-ID")}`);
    console.log(`[EDC QRIS] Serial Port   : ${portPath}`);
    console.log(`[EDC QRIS] Baud Rate     : ${baudRate}
`);
    let activePort;
    try {
      const portOptions = {
        path: portPath,
        baudRate,
        dataBits: 8,
        parity: "none",
        stopBits: 1,
        autoOpen: false
      };
      activePort = host.createPort ? host.createPort(portOptions) : new import_serialport2.SerialPort(portOptions);
      host.setActivePort(activePort);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Gagal inisialisasi port";
      return resolve({ success: false, message: `Gagal menginisialisasi Serial Port (${portPath}): ${message}` });
    }
    const timer = setTimeout(() => {
      if (!isSettled) {
        isSettled = true;
        if (awaitingPaymentResult) {
          host.markRecoveryRequired?.({
            reason: `Waktu transaksi di EDC habis (Timeout ${timeoutMs / 1e3}s) saat menunggu respons pembayaran QRIS`,
            amount,
            paymentType: "QRIS",
            portPath
          });
          host.cleanup(activePort);
          return resolve({
            success: false,
            responseCode: "RECOVERY_REQUIRED",
            message: `Waktu transaksi di EDC habis setelah request QRIS dikirim. Status transaksi ambigu di EDC \u2014 Lakukan pengecekan fisik/inquiry.`
          });
        }
        host.cleanup(activePort);
        resolve({
          success: false,
          message: `Waktu transaksi di EDC habis (Timeout ${timeoutMs / 1e3}s). Pembayaran dibatalkan.`
        });
      }
    }, timeoutMs);
    const finish = (result) => {
      if (!isSettled) {
        isSettled = true;
        clearTimeout(timer);
        host.cleanup(activePort);
        resolve(result);
      }
    };
    const sendFrame = () => {
      if (saleFrameSent || !host.getActivePort()?.isOpen) return;
      saleFrameSent = true;
      const frame = buildQrisPaymentFrame(amount);
      console.log("[EDC QRIS] Mengirim frame ke EDC terminal...");
      host.getActivePort().write(frame);
    };
    activePort.open((openErr) => {
      if (openErr) {
        return finish({
          success: false,
          message: `Tidak dapat membuka Serial Port EDC (${portPath}): ${openErr.message}`
        });
      }
      try {
        activePort.set({ dtr: true, rts: true });
      } catch (_) {
      }
      activePort.on("data", (chunk) => {
        bufferAccumulator = Buffer.concat([bufferAccumulator, chunk]);
        logRxChunk(chunk);
        if (chunk.includes(5)) {
          console.log("[EDC QRIS] Menerima ENQ \u2014 balas ACK");
          host.getActivePort()?.write(Buffer.from([6]));
          if (!saleFrameSent) setTimeout(() => sendFrame(), 100);
        }
        if (bufferAccumulator.length === 1 && bufferAccumulator[0] === 4) {
          bufferAccumulator = Buffer.alloc(0);
          return;
        }
        if (bufferAccumulator.length === 1 && bufferAccumulator[0] === 6) {
          if (saleFrameSent) {
            console.log("[EDC QRIS] Menunggu pelanggan scan QR code...");
            awaitingPaymentResult = true;
          } else {
            sendFrame();
          }
          bufferAccumulator = Buffer.alloc(0);
          return;
        }
        if (isBufferNak(bufferAccumulator)) {
          if (awaitingPaymentResult) {
            bufferAccumulator = Buffer.alloc(0);
            return finish({ success: false, responseCode: "10", message: mapEdcErrorMessage("10", "ER") });
          }
          return finish({
            success: false,
            message: "EDC menolak paket data (NAK - Format/LRC Salah)",
            rawHexResponse: bufferAccumulator.toString("hex")
          });
        }
        if (bufferAccumulator[0] === 6 && bufferAccumulator.length > 1) {
          if (saleFrameSent) awaitingPaymentResult = true;
          bufferAccumulator = bufferAccumulator.subarray(1);
        }
        const stxIdx = bufferAccumulator.indexOf(2);
        const etxIdx = bufferAccumulator.lastIndexOf(3);
        if (stxIdx === -1 || etxIdx === -1 || etxIdx <= stxIdx) return;
        if (bufferAccumulator.length < etxIdx + 2) return;
        if (saleFrameSent && !awaitingPaymentResult) return;
        const fullFrame = bufferAccumulator.subarray(stxIdx, etxIdx + 2);
        const payload = bufferAccumulator.subarray(stxIdx + 1, etxIdx);
        const parsed = parseDirectResponse(payload);
        if (isShortTerminalError(payload) && parsed.respCode === "10" && parsed.detail.startsWith("ER")) {
          return finish({
            success: false,
            responseCode: "10",
            message: mapEdcErrorMessage(parsed.respCode, parsed.detail),
            rawHexResponse: fullFrame.toString("hex")
          });
        }
        writeLinkAck(host.getActivePort(), `qris resp ${parsed.respCode}`);
        const isSuccess = parsed.respCode === "00";
        return finish(
          paymentResponseFromParsed(parsed, isSuccess, fullFrame.toString("hex"), "Pembayaran EDC Berhasil")
        );
      });
      activePort.on("error", (err) => {
        if (awaitingPaymentResult) {
          host.markRecoveryRequired?.({
            reason: `Koneksi serial EDC error saat menunggu hasil transaksi QRIS: ${err.message}`,
            amount,
            paymentType: "QRIS",
            portPath,
            lastError: err.message
          });
          return finish({
            success: false,
            responseCode: "RECOVERY_REQUIRED",
            message: `Koneksi Serial EDC Error setelah request QRIS dikirim (${err.message}). Status ambigu di EDC \u2014 Wajib recovery / cek struk EDC fisik.`
          });
        }
        finish({ success: false, message: `Koneksi Serial EDC Error: ${err.message}` });
      });
      activePort.on("close", () => {
        if (!isSettled) {
          if (awaitingPaymentResult) {
            host.markRecoveryRequired?.({
              reason: "Port serial EDC terputus saat menunggu respons QRIS (close event)",
              amount,
              paymentType: "QRIS",
              portPath
            });
            return finish({
              success: false,
              responseCode: "RECOVERY_REQUIRED",
              message: "Port serial EDC terputus setelah request pembayaran QRIS dikirim. Status transaksi ambigu di EDC \u2014 Wajib recovery / cek struk EDC fisik."
            });
          }
          finish({
            success: false,
            message: "Port serial EDC terputus. Tutup script test, lalu coba bayar lagi di POS."
          });
        }
      });
      setTimeout(() => sendFrame(), getPreSendDelayMs());
    });
  });
}
function processQrisPayment(host, params) {
  if (params.connectionType === "TCP_IP") {
    return processQrisPaymentTcp(params);
  }
  const portPath = params.portPath?.trim();
  if (!portPath) {
    return Promise.resolve({
      success: false,
      message: "Port serial EDC belum dikonfigurasi. Buka Pengaturan \u2192 EDC Configuration."
    });
  }
  return processQrisPaymentSerial(host, { ...params, portPath });
}

// electron/edc/src/edc/edc-qris-inquiry.ts
var net3 = __toESM(require("net"), 1);
var import_serialport3 = require("serialport");
var ETX = 3;
var MAX_REFERENCE_LENGTH = 32;
function getInquiryVersionByte() {
  return parseHexByteEnv(process.env.EDC_QRIS_INQUIRY_VERSION, 1);
}
function getLastInquiryTypeByte() {
  return parseHexByteEnv(process.env.EDC_QRIS_LAST_TYPE, 61);
}
function getLastInquirySubTypeByte() {
  return parseHexByteEnv(process.env.EDC_QRIS_LAST_SUB_TYPE, 48);
}
function getAnyInquiryTypeByte() {
  return parseHexByteEnv(process.env.EDC_QRIS_ANY_TYPE, 62);
}
function getAnyInquirySubTypeByte() {
  return parseHexByteEnv(process.env.EDC_QRIS_ANY_SUB_TYPE, 48);
}
function normalizeInquiryReference(referenceNumber) {
  const trimmed = referenceNumber.trim();
  if (!trimmed) {
    throw new Error("Reference number wajib untuk QRIS Any Transaction inquiry.");
  }
  if (trimmed.length > MAX_REFERENCE_LENGTH) {
    throw new Error(`Reference number melebihi batas ${MAX_REFERENCE_LENGTH} karakter.`);
  }
  return trimmed;
}
function buildQrisLastTransactionFrame() {
  const versionByte = getInquiryVersionByte();
  const typeByte = getLastInquiryTypeByte();
  const subTypeByte = getLastInquirySubTypeByte();
  const headerBuf = Buffer.from([versionByte, typeByte, subTypeByte]);
  console.log("===========================================================");
  console.log("              QRIS LAST TRANSACTION INQUIRY                 ");
  console.log("===========================================================");
  console.log(`    STX            : 0x02`);
  console.log(`    Version        : 0x${versionByte.toString(16).toUpperCase().padStart(2, "0")}`);
  console.log(`    Type           : 0x${typeByte.toString(16).toUpperCase().padStart(2, "0")}`);
  console.log(`    SubType        : 0x${subTypeByte.toString(16).toUpperCase().padStart(2, "0")}`);
  console.log(`    ETX            : 0x${ETX.toString(16).toUpperCase().padStart(2, "0")}`);
  console.log("    Data 1         : (none)");
  console.log("-----------------------------------------------------------");
  const bodyBuf = Buffer.concat([headerBuf, Buffer.from([ETX])]);
  const finalFrame = buildStxLrcFrame(bodyBuf);
  console.log(
    `  LRC/CRC          : 0x${finalFrame[finalFrame.length - 1].toString(16).toUpperCase().padStart(2, "0")}`
  );
  console.log(`  Complete Frame   : ${finalFrame.toString("hex").toUpperCase()}`);
  console.log("===========================================================\n");
  return finalFrame;
}
function buildQrisAnyTransactionFrame(referenceNumber) {
  const refField = normalizeInquiryReference(referenceNumber);
  const versionByte = getInquiryVersionByte();
  const typeByte = getAnyInquiryTypeByte();
  const subTypeByte = getAnyInquirySubTypeByte();
  const headerBuf = Buffer.from([versionByte, typeByte, subTypeByte]);
  console.log("===========================================================");
  console.log("               QRIS ANY TRANSACTION INQUIRY                 ");
  console.log("===========================================================");
  console.log(`    STX            : 0x02`);
  console.log(`    Version        : 0x${versionByte.toString(16).toUpperCase().padStart(2, "0")}`);
  console.log(`    Type           : 0x${typeByte.toString(16).toUpperCase().padStart(2, "0")}`);
  console.log(`    SubType        : 0x${subTypeByte.toString(16).toUpperCase().padStart(2, "0")}`);
  console.log(`    Data 1 (Reff)   : ${refField}`);
  console.log(`    ETX            : 0x${ETX.toString(16).toUpperCase().padStart(2, "0")}`);
  console.log("-----------------------------------------------------------");
  const bodyBuf = Buffer.concat([
    headerBuf,
    Buffer.from(refField, "ascii"),
    Buffer.from([ETX])
  ]);
  const finalFrame = buildStxLrcFrame(bodyBuf);
  console.log(
    `  LRC/CRC          : 0x${finalFrame[finalFrame.length - 1].toString(16).toUpperCase().padStart(2, "0")}`
  );
  console.log(`  Complete Frame   : ${finalFrame.toString("hex").toUpperCase()}`);
  console.log("===========================================================\n");
  return finalFrame;
}
function resolveInquiryFrame(params) {
  if (params.inquiryKind === "ANY") {
    return buildQrisAnyTransactionFrame(params.referenceNumber);
  }
  return buildQrisLastTransactionFrame();
}
function runInquiryTcp(params, frame, successMessage) {
  const ip = params.ipTerminal?.trim();
  const port = params.port;
  const { timeoutMs = 3e4 } = params;
  if (!ip || !port) {
    return Promise.resolve({
      success: false,
      message: "IP Terminal dan Port wajib untuk inquiry EDC TCP/IP."
    });
  }
  return new Promise((resolve) => {
    let settled = false;
    let bufferAccumulator = Buffer.alloc(0);
    const client = net3.createConnection({ host: ip, port });
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try {
        client.destroy();
      } catch (_) {
      }
      resolve(result);
    };
    const timer = setTimeout(() => {
      finish({
        success: false,
        message: `Waktu inquiry QRIS di EDC habis (Timeout ${timeoutMs / 1e3}s).`
      });
    }, timeoutMs);
    client.setTimeout(timeoutMs);
    client.on("connect", () => {
      setTimeout(() => client.write(frame), 300);
    });
    client.on("data", (chunk) => {
      bufferAccumulator = Buffer.concat([bufferAccumulator, chunk]);
      const stxIdx = bufferAccumulator.indexOf(2);
      const etxIdx = bufferAccumulator.lastIndexOf(3);
      if (stxIdx === -1 || etxIdx === -1 || etxIdx <= stxIdx) return;
      if (bufferAccumulator.length < etxIdx + 2) return;
      clearTimeout(timer);
      const payload = bufferAccumulator.subarray(stxIdx + 1, etxIdx);
      const parsed = parseDirectResponse(payload);
      finish(
        paymentResponseFromParsed(
          parsed,
          parsed.respCode === "00",
          bufferAccumulator.toString("hex"),
          successMessage
        )
      );
    });
    client.on("timeout", () => {
      clearTimeout(timer);
      finish({ success: false, message: `Timeout: Unable to connect to ${ip}:${port}` });
    });
    client.on("error", (err) => {
      clearTimeout(timer);
      finish({ success: false, message: `Koneksi TCP EDC error: ${err.message}` });
    });
  });
}
function runInquirySerial(host, params, frame, successMessage) {
  let { portPath, baudRate = getDefaultBaudRate(), timeoutMs = 3e4 } = params;
  portPath = normalizeSerialPortPath(portPath);
  return new Promise((resolve) => {
    let isSettled = false;
    let bufferAccumulator = Buffer.alloc(0);
    let inquiryFrameSent = false;
    let awaitingInquiryResult = false;
    console.log("\n+-----------------------------------------------------------+");
    console.log(`|       MEMULAI QRIS INQUIRY (${params.inquiryKind})                    |`);
    console.log("+-----------------------------------------------------------+");
    console.log(`[EDC Inquiry] Serial Port   : ${portPath}`);
    console.log(`[EDC Inquiry] Baud Rate     : ${baudRate}`);
    console.log(`[EDC Inquiry] Timeout       : ${timeoutMs / 1e3}s
`);
    let activePort;
    try {
      const portOptions = {
        path: portPath,
        baudRate,
        dataBits: 8,
        parity: "none",
        stopBits: 1,
        autoOpen: false
      };
      activePort = host.createPort ? host.createPort(portOptions) : new import_serialport3.SerialPort(portOptions);
      host.setActivePort(activePort);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Gagal inisialisasi port";
      return resolve({
        success: false,
        message: `Gagal menginisialisasi Serial Port (${portPath}): ${message}`
      });
    }
    const timer = setTimeout(() => {
      if (!isSettled) {
        isSettled = true;
        host.cleanup(activePort);
        resolve({
          success: false,
          message: `Waktu inquiry QRIS di EDC habis (Timeout ${timeoutMs / 1e3}s).`
        });
      }
    }, timeoutMs);
    const finish = (result) => {
      if (!isSettled) {
        isSettled = true;
        clearTimeout(timer);
        host.cleanup(activePort);
        resolve(result);
      }
    };
    const sendFrame = () => {
      if (inquiryFrameSent || !host.getActivePort()?.isOpen) return;
      inquiryFrameSent = true;
      console.log("[EDC Inquiry] Mengirim frame inquiry ke EDC terminal...");
      host.getActivePort().write(frame);
    };
    activePort.open((openErr) => {
      if (openErr) {
        return finish({
          success: false,
          message: `Tidak dapat membuka Serial Port EDC (${portPath}): ${openErr.message}`
        });
      }
      try {
        activePort.set({ dtr: true, rts: true });
      } catch (_) {
      }
      activePort.on("data", (chunk) => {
        bufferAccumulator = Buffer.concat([bufferAccumulator, chunk]);
        logRxChunk(chunk);
        if (chunk.includes(5)) {
          console.log("[EDC Inquiry] Menerima ENQ \u2014 balas ACK");
          host.getActivePort()?.write(Buffer.from([6]));
          if (!inquiryFrameSent) setTimeout(() => sendFrame(), 100);
        }
        if (bufferAccumulator.length === 1 && bufferAccumulator[0] === 4) {
          bufferAccumulator = Buffer.alloc(0);
          return;
        }
        if (bufferAccumulator.length === 1 && bufferAccumulator[0] === 6) {
          if (inquiryFrameSent) {
            awaitingInquiryResult = true;
          } else {
            sendFrame();
          }
          bufferAccumulator = Buffer.alloc(0);
          return;
        }
        if (isBufferNak(bufferAccumulator)) {
          if (awaitingInquiryResult) {
            bufferAccumulator = Buffer.alloc(0);
            return finish({
              success: false,
              responseCode: "10",
              message: mapEdcErrorMessage("10", "ER")
            });
          }
          return finish({
            success: false,
            message: "EDC menolak paket data (NAK - Format/LRC Salah)",
            rawHexResponse: bufferAccumulator.toString("hex")
          });
        }
        if (bufferAccumulator[0] === 6 && bufferAccumulator.length > 1) {
          if (inquiryFrameSent) awaitingInquiryResult = true;
          bufferAccumulator = bufferAccumulator.subarray(1);
        }
        const stxIdx = bufferAccumulator.indexOf(2);
        const etxIdx = bufferAccumulator.lastIndexOf(3);
        if (stxIdx === -1 || etxIdx === -1 || etxIdx <= stxIdx) return;
        if (bufferAccumulator.length < etxIdx + 2) return;
        if (inquiryFrameSent && !awaitingInquiryResult) return;
        const fullFrame = bufferAccumulator.subarray(stxIdx, etxIdx + 2);
        const payload = bufferAccumulator.subarray(stxIdx + 1, etxIdx);
        const parsed = parseDirectResponse(payload);
        if (isShortTerminalError(payload) && parsed.respCode === "10" && parsed.detail.startsWith("ER")) {
          return finish({
            success: false,
            responseCode: "10",
            message: mapEdcErrorMessage(parsed.respCode, parsed.detail),
            rawHexResponse: fullFrame.toString("hex")
          });
        }
        writeLinkAck(host.getActivePort(), `qris inquiry resp ${parsed.respCode}`);
        const isSuccess = parsed.respCode === "00";
        return finish(
          paymentResponseFromParsed(parsed, isSuccess, fullFrame.toString("hex"), successMessage)
        );
      });
      activePort.on("error", (err) => {
        finish({ success: false, message: `Koneksi Serial EDC Error: ${err.message}` });
      });
      activePort.on("close", () => {
        if (!isSettled) {
          finish({
            success: false,
            message: "Port serial EDC terputus saat inquiry QRIS."
          });
        }
      });
      setTimeout(() => sendFrame(), getPreSendDelayMs());
    });
  });
}
function runQrisInquiry(host, params, successMessage) {
  let frame;
  try {
    frame = resolveInquiryFrame(params);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Parameter inquiry tidak valid.";
    return Promise.resolve({ success: false, message });
  }
  if (params.connectionType === "TCP_IP") {
    return runInquiryTcp(params, frame, successMessage);
  }
  const portPath = params.portPath?.trim();
  if (!portPath) {
    return Promise.resolve({
      success: false,
      message: "Port serial EDC belum dikonfigurasi. Buka Pengaturan \u2192 EDC Configuration."
    });
  }
  return runInquirySerial(host, { ...params, portPath }, frame, successMessage);
}
function inquiryQrisLastTransaction(host, params) {
  return runQrisInquiry(host, params, "Inquiry QRIS Last Transaction berhasil");
}
function inquiryQrisAnyTransaction(host, params) {
  return runQrisInquiry(host, params, "Inquiry QRIS Any Transaction berhasil");
}

// electron/edc/src/edc/edc-void.ts
var fs = __toESM(require("fs"), 1);
var path = __toESM(require("path"), 1);
var import_serialport4 = require("serialport");
function normalizeVoidTraceNumber(traceNumber) {
  const voidDigits = (() => {
    const parsed = parseInt(process.env.EDC_VOID_TRACE_DIGITS || "6", 10);
    return Number.isNaN(parsed) ? 6 : parsed;
  })();
  let digits = (traceNumber || "").replace(/\D/g, "");
  if (!digits) {
    return "0".repeat(voidDigits);
  }
  if (digits.length > voidDigits) {
    console.warn(
      `[EDC Void] Trace "${digits}" lebih dari ${voidDigits} digit \u2014 gunakan nomor 6 digit dari struk EDC Danamon (invoice/sequence), bukan Reference/STAN.`
    );
    digits = digits.slice(-voidDigits);
  }
  return digits.padStart(voidDigits, "0");
}
function buildIngenicoVoidFrame(paymentType, traceNumber) {
  const STX = 2;
  const ETX2 = 3;
  const traceStr = normalizeVoidTraceNumber(traceNumber);
  const voidVersionByte = parseHexByteEnv(process.env.EDC_VOID_VERSION, 1);
  const voidTypeByte = parseHexByteEnv(process.env.EDC_VOID_TYPE, 50);
  const voidSubTypeByte = parseHexByteEnv(process.env.EDC_VOID_SUB_TYPE, 48);
  const headerBuf = Buffer.from([voidVersionByte, voidTypeByte, voidSubTypeByte]);
  console.log("===========================================================");
  console.log(`              ${paymentType} VOID TRANSACTION FRAME        `);
  console.log("===========================================================");
  console.log(`  PaymentType      : ${paymentType}`);
  console.log(`  Trace Number     : ${traceStr} (${traceStr.length} digit ASCII \u2014 nomor struk EDC Danamon)`);
  console.log("-----------------------------------------------------------");
  console.log("  Frame Structure (ECR VOID \u2014 tanpa Amount):");
  console.log(`    STX            : 0x${STX.toString(16).toUpperCase().padStart(2, "0")}`);
  console.log(`    Version        : 0x${voidVersionByte.toString(16).toUpperCase().padStart(2, "0")}`);
  console.log(`    Type           : 0x${voidTypeByte.toString(16).toUpperCase().padStart(2, "0")}`);
  console.log(`    Sub Type       : 0x${voidSubTypeByte.toString(16).toUpperCase().padStart(2, "0")}`);
  console.log(`    Trace Number   : ${traceStr}`);
  console.log(`    ETX            : 0x${ETX2.toString(16).toUpperCase().padStart(2, "0")}`);
  console.log("-----------------------------------------------------------");
  const bodyBuf = Buffer.concat([headerBuf, Buffer.from(traceStr, "ascii"), Buffer.from([ETX2])]);
  let lrcByte = 0;
  for (let i = 0; i < bodyBuf.length; i++) {
    lrcByte ^= bodyBuf[i];
  }
  const finalFrame = Buffer.concat([Buffer.from([STX]), bodyBuf, Buffer.from([lrcByte])]);
  console.log(`  LRC/CRC          : 0x${lrcByte.toString(16).toUpperCase().padStart(2, "0")}`);
  console.log("-----------------------------------------------------------");
  console.log(`  Complete Frame   : ${finalFrame.toString("hex").toUpperCase()}`);
  console.log("===========================================================\n");
  return finalFrame;
}
function resolveVoidSerialLogDir() {
  const base = process.env.SAKUPOS_VOID_LOG_DIR?.trim() || (process.platform === "win32" && process.env.APPDATA ? path.join(process.env.APPDATA, "sakupos-coffee", "logs", "edc-void") : path.join(process.cwd(), "logs", "edc-void"));
  fs.mkdirSync(base, { recursive: true });
  return base;
}
function createVoidSerialSessionLogger(sessionId, meta) {
  const filePath = path.join(resolveVoidSerialLogDir(), `void-serial-${sessionId}.log`);
  const append = (line) => {
    try {
      fs.appendFileSync(filePath, `${line}
`, "utf8");
    } catch {
    }
  };
  append("=== EDC VOID Serial Session ===");
  append(`started=${(/* @__PURE__ */ new Date()).toISOString()}`);
  for (const [key, value] of Object.entries(meta)) {
    append(`${key}=${value}`);
  }
  append("--- raw exchange (post-ACK focus for TMS comparison) ---");
  append("Investigation: jika setelah ACK tidak ada RX sampai tombol VOID manual \u2192 TMS ECR Direct Void belum aktif.");
  append("Auto-execute sukses: biasanya RX STX result tanpa byte POS tambahan (bukan EOT \u2014 EOT dari POS \u2192 NAK).");
  console.log(`[EDC VOID Serial Log] ${filePath}`);
  return { filePath, append };
}
function logVoidLinkExchange(direction, data, context, exchangeSeq, voidPhase, options) {
  exchangeSeq.value += 1;
  const classification = classifyLinkChunk(data);
  const ackDelta = options?.msFromAck != null ? ` +${options.msFromAck}ms-from-ack` : "";
  const header = `[EDC VOID Trace #${exchangeSeq.value}] ${(/* @__PURE__ */ new Date()).toISOString()} ${direction} phase=${voidPhase} class=${classification} ctx=${context}${ackDelta}`;
  console.log(header);
  console.log(`  hex   : ${data.toString("hex").toUpperCase()}`);
  console.log(`  bytes : ${formatLinkByteTrace(data)}`);
  console.log(`  len   : ${data.length}`);
  if (options?.note) {
    console.log(`  note  : ${options.note}`);
  }
  if (data.includes(2) && data.includes(3)) {
    const stxIdx = data.indexOf(2);
    const etxIdx = data.lastIndexOf(3);
    if (etxIdx > stxIdx) {
      const asciiPayload = data.subarray(stxIdx + 1, etxIdx).toString("ascii");
      console.log(`  ascii : ${asciiPayload.substring(0, 120)}${asciiPayload.length > 120 ? "\u2026" : ""}`);
    }
  }
  options?.sessionLog?.(
    `${header}
  hex=${data.toString("hex").toUpperCase()}
  bytes=${formatLinkByteTrace(data)}` + (options.note ? `
  note=${options.note}` : "")
  );
}
function isVoidEnqFirstEnabled() {
  return (process.env.EDC_VOID_ENQ_FIRST || "false").toLowerCase() === "true";
}
function getVoidEnqFallbackMs() {
  const parsed = parseInt(process.env.EDC_VOID_ENQ_FALLBACK_MS || "3000", 10);
  return Number.isNaN(parsed) ? 3e3 : parsed;
}
function voidEdcTransaction(host, params) {
  let {
    portPath,
    amount,
    paymentType,
    traceNumber,
    baudRate = getDefaultBaudRate(),
    timeoutMs = getDefaultEdcTimeoutMs()
  } = params;
  if (!traceNumber?.trim()) {
    return Promise.resolve({
      success: false,
      message: "Trace Number EDC (6 digit struk) wajib untuk void."
    });
  }
  if (process.platform === "darwin" && portPath.startsWith("/dev/tty.")) {
    portPath = portPath.replace("/dev/tty.", "/dev/cu.");
  }
  return new Promise((resolve) => {
    let isSettled = false;
    let bufferAccumulator = Buffer.alloc(0);
    let voidFrameSent = false;
    let voidFrameAcked = false;
    let awaitingVoidResult = false;
    let voidPhase = "INIT";
    let lastRxAt = Date.now();
    let voidAckAtMs = null;
    let postAckRxCount = 0;
    let postAckTxCount = 0;
    let postAckIdleTimer = null;
    const exchangeSeq = { value: 0 };
    const voidEnqFirst = isVoidEnqFirstEnabled();
    const sessionId = `${Date.now()}-${traceNumber}`;
    const sessionLog = createVoidSerialSessionLogger(sessionId, {
      trace: traceNumber,
      paymentType,
      portPath,
      baudRate: String(baudRate),
      requestFrame: "01 32 30 + trace (unchanged)"
    });
    const appendSessionSummary = (outcome, detail) => {
      sessionLog.append("--- session summary ---");
      sessionLog.append(`outcome=${outcome}`);
      if (voidAckAtMs != null) {
        sessionLog.append(`ackAt=${new Date(voidAckAtMs).toISOString()}`);
      }
      sessionLog.append(`postAckRxCount=${postAckRxCount}`);
      sessionLog.append(`postAckTxCount=${postAckTxCount}`);
      if (detail) {
        sessionLog.append(`detail=${detail}`);
      }
      if (postAckRxCount === 0 && voidAckAtMs != null) {
        sessionLog.append(
          "finding=NO_SERIAL_AFTER_ACK \u2192 terminal UI-only VOID menu; minta Danamon ICT enable ECR Direct/Auto Execute Void"
        );
      } else if (postAckRxCount > 0 && voidAckAtMs != null) {
        sessionLog.append(
          "finding=SERIAL_AFTER_ACK \u2192 compare delta-ms-from-ack dengan flow tombol VOID manual di terminal"
        );
      }
    };
    const clearPostAckIdleTimer = () => {
      if (postAckIdleTimer) {
        clearInterval(postAckIdleTimer);
        postAckIdleTimer = null;
      }
    };
    const writeVoidLink = (data, context, note) => {
      if (voidFrameAcked) {
        postAckTxCount += 1;
      }
      logVoidLinkExchange("TX", data, context, exchangeSeq, voidPhase, {
        msFromAck: voidAckAtMs != null ? Date.now() - voidAckAtMs : null,
        sessionLog: voidFrameAcked ? sessionLog.append : void 0,
        note
      });
      host.getActivePort()?.write(data);
    };
    const logVoidRx = (chunk, context, note) => {
      if (voidFrameAcked) {
        postAckRxCount += 1;
      }
      logVoidLinkExchange("RX", chunk, context, exchangeSeq, voidPhase, {
        msFromAck: voidAckAtMs != null ? Date.now() - voidAckAtMs : null,
        sessionLog: voidFrameAcked ? sessionLog.append : sessionLog.append,
        note
      });
    };
    const startPostAckIdleMonitor = () => {
      clearPostAckIdleTimer();
      postAckIdleTimer = setInterval(() => {
        if (isSettled || !voidFrameAcked) {
          return;
        }
        const silentSec = Math.round((Date.now() - lastRxAt) / 1e3);
        console.log(`[EDC VOID Post-ACK] idle ${silentSec}s \u2014 belum ada byte dari EDC setelah ACK void frame.`);
        console.log("  Jika terminal menampilkan layar VOID + password tapi menunggu tombol VOID manual,");
        console.log(
          "  kemungkinan TMS belum mode ECR Direct Void \u2014 hubungi Danamon ICT untuk enable ECR auto-execute."
        );
        console.log("  POS hanya merespons ENQ\u2192ACK; tidak mengirim EOT (0x04) karena terminal membalas NAK.");
      }, 15e3);
    };
    const markVoidFrameAcked = () => {
      if (voidFrameAcked) return;
      voidFrameAcked = true;
      awaitingVoidResult = true;
      voidAckAtMs = Date.now();
      voidPhase = "POST_ACK_WAIT";
      sessionLog.append(`--- POST_ACK_WAIT @ ${new Date(voidAckAtMs).toISOString()} ---`);
      sessionLog.append("POS action after ACK: NONE (no EOT \u2014 terminal NAK on EOT from POS)");
      sessionLog.append("Expected EDC: auto execute VOID \u2192 STX result (or ENQ prompt if any)");
      console.log(
        "[EDC Manager] EDC ACK void frame \u2014 fase POST_ACK_WAIT: terminal seharusnya eksekusi VOID langsung"
      );
      console.log(
        "[EDC Manager] POS menunggu byte berikutnya dari EDC (ENQ / prompt / STX result). Tidak kirim EOT."
      );
      console.log(`[EDC VOID Serial Log] bandingkan semua RX/TX post-ACK di: ${sessionLog.filePath}`);
      startPostAckIdleMonitor();
    };
    console.log("\n+-----------------------------------------------------------+");
    console.log(`|          MEMULAI VOID TRANSAKSI EDC - ${paymentType.padEnd(6, " ")}         |`);
    console.log("+-----------------------------------------------------------+");
    console.log(`[EDC Manager] Payment Type  : ${paymentType}`);
    console.log(`[EDC Manager] Trace Number  : ${traceNumber} (6 digit \u2014 payload VOID)`);
    if (amount > 0) {
      console.log(
        `[EDC Manager] Sale Amount   : Rp ${amount.toLocaleString("id-ID")} (referensi UI saja, tidak dikirim ke EDC)`
      );
    }
    console.log(`[EDC Manager] Serial Port   : ${portPath}`);
    console.log(`[EDC Manager] Baud Rate     : ${baudRate}`);
    console.log(`[EDC Manager] Timeout       : ${timeoutMs / 1e3}s
`);
    try {
      const portOptions = {
        path: portPath,
        baudRate,
        dataBits: 8,
        parity: "none",
        stopBits: 1,
        autoOpen: false
      };
      const createdPort = host.createPort ? host.createPort(portOptions) : new import_serialport4.SerialPort(portOptions);
      host.setActivePort(createdPort);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return resolve({
        success: false,
        message: `Gagal menginisialisasi Serial Port (${portPath}): ${message}`
      });
    }
    const activePort = host.getActivePort();
    if (!activePort) {
      return resolve({
        success: false,
        message: `Gagal menginisialisasi Serial Port (${portPath}): port tidak tersedia`
      });
    }
    const timer = setTimeout(() => {
      if (!isSettled) {
        isSettled = true;
        appendSessionSummary("TIMEOUT", `No EDC result within ${timeoutMs / 1e3}s after ACK`);
        console.log("+===========================================================+");
        console.log("|                    VOID TIMEOUT                           |");
        console.log("+===========================================================+");
        console.log(`|  Payment Type      : ${paymentType.padEnd(37, " ")}|`);
        console.log(
          `|  Timeout Duration  : ${(timeoutMs / 1e3).toString()}s${" ".repeat(34 - (timeoutMs / 1e3).toString().length)}|`
        );
        console.log(`|  Amount (Rp)       : ${amount.toLocaleString("id-ID").padEnd(37, " ")}|`);
        console.log("+===========================================================+\n");
        host.cleanup(activePort);
        resolve({
          success: false,
          message: `Waktu void transaksi di EDC habis (Timeout ${timeoutMs / 1e3}s). Void dibatalkan.`
        });
      }
    }, timeoutMs);
    const finish = (result) => {
      if (!isSettled) {
        isSettled = true;
        clearTimeout(timer);
        clearPostAckIdleTimer();
        appendSessionSummary(result.success ? "SUCCESS" : "FAILED", result.message);
        host.cleanup(activePort);
        resolve(result);
      }
    };
    const sendVoidFrame = () => {
      const port = host.getActivePort();
      if (voidFrameSent || !port?.isOpen) return;
      voidFrameSent = true;
      voidPhase = "FRAME_SENT";
      const frame = buildIngenicoVoidFrame(paymentType, traceNumber);
      console.log(`[EDC Manager] Mengirim frame VOID ke EDC terminal...`);
      writeVoidLink(frame, "void-frame", "LRC=0x04 (bukan EOT \u2014 kebetulan nilai sama dengan 0x04)");
    };
    activePort.open((openErr) => {
      if (openErr) {
        console.log("+===========================================================+");
        console.log("|             GAGAL MEMBUKA SERIAL PORT                     |");
        console.log("+===========================================================+");
        console.log(`|  Payment Type      : ${paymentType.padEnd(37, " ")}|`);
        console.log(`|  Port Path         : ${portPath.substring(0, 37).padEnd(37, " ")}|`);
        console.log(`|  Error Message     : ${openErr.message.substring(0, 37).padEnd(37, " ")}|`);
        console.log("+===========================================================+\n");
        return finish({
          success: false,
          message: `Tidak dapat membuka Serial Port EDC (${portPath}): ${openErr.message}`
        });
      }
      console.log(`[EDC Manager] Serial port berhasil dibuka
`);
      const port = host.getActivePort();
      if (!port) {
        return finish({
          success: false,
          message: `Serial Port EDC (${portPath}) tidak tersedia setelah open`
        });
      }
      try {
        port.set({ dtr: true, rts: true });
      } catch (_) {
      }
      port.on("data", (chunk) => {
        lastRxAt = Date.now();
        bufferAccumulator = Buffer.concat([bufferAccumulator, chunk]);
        const rxContext = voidFrameAcked ? "post-ack-rx" : "pre-ack-rx";
        logVoidRx(chunk, rxContext);
        if (voidFrameAcked) {
          console.log(
            `[EDC VOID Post-ACK] chunk class=${classifyLinkChunk(chunk)} accumulator=${bufferAccumulator.length}B +${Date.now() - (voidAckAtMs ?? Date.now())}ms-from-ack`
          );
        }
        if (chunk.includes(5)) {
          console.log("[EDC Manager] Menerima ENQ (0x05) dari EDC");
          if (voidFrameAcked) {
            console.log(
              "[EDC VOID Post-ACK] ENQ dari EDC \u2014 balas ACK saja; catat apakah ini prompt sebelum eksekusi VOID"
            );
          }
          writeVoidLink(Buffer.from([6]), voidFrameAcked ? "post-ack-enq-ack" : "pre-ack-enq-ack");
          if (!voidFrameSent) {
            setTimeout(() => sendVoidFrame(), 100);
          }
        }
        if (bufferAccumulator.length === 1 && bufferAccumulator[0] === 4) {
          console.log("[EDC Manager] Menerima EOT (0x04) dari EDC \u2014 sesi link-layer berakhir");
          if (voidFrameAcked) {
            console.log("[EDC VOID Post-ACK] EOT dari EDC (bukan dari POS) \u2014 tunggu STX result jika belum");
          }
          bufferAccumulator = Buffer.alloc(0);
          return;
        }
        if (bufferAccumulator.length === 1 && bufferAccumulator[0] === 6) {
          if (voidFrameSent) {
            console.log("[EDC Manager] EDC merespons ACK (0x06) ke frame VOID");
            markVoidFrameAcked();
          } else {
            console.log("[EDC Manager] EDC merespons ACK ke ENQ \u2014 kirim frame VOID");
            sendVoidFrame();
          }
          bufferAccumulator = Buffer.alloc(0);
          return;
        }
        if (isEdcLinkNak(bufferAccumulator)) {
          const nakMessage = voidFrameAcked ? "EDC mengirim NAK (0x15) saat proses VOID" : "EDC menolak frame VOID (NAK 0x15 \u2014 format/LRC salah)";
          const rawHex = bufferAccumulator.toString("hex");
          console.log("+===========================================================+");
          console.log("|                    TRANSAKSI VOID GAGAL                   |");
          console.log("+===========================================================+");
          console.log(`|  Payment Type      : ${paymentType.padEnd(37, " ")}|`);
          console.log(`|  Error             : ${nakMessage.substring(0, 37).padEnd(37, " ")}|`);
          console.log(`|  Raw Hex           : ${rawHex.toUpperCase().substring(0, 37).padEnd(37, " ")}|`);
          console.log("+===========================================================+\n");
          bufferAccumulator = Buffer.alloc(0);
          return finish({
            success: false,
            message: nakMessage,
            rawHexResponse: rawHex
          });
        }
        if (bufferAccumulator[0] === 6 && bufferAccumulator.length > 1) {
          if (voidFrameSent) {
            markVoidFrameAcked();
            console.log("[EDC Manager] EDC merespons ACK (0x06) + data respons VOID");
          }
          bufferAccumulator = bufferAccumulator.subarray(1);
        }
        const stxIdx = bufferAccumulator.indexOf(2);
        const etxIdx = bufferAccumulator.lastIndexOf(3);
        if (stxIdx === -1 || etxIdx === -1 || etxIdx <= stxIdx) {
          if (voidFrameAcked && bufferAccumulator.length > 0) {
            console.log(
              `[EDC VOID Post-ACK] buffer partial (${bufferAccumulator.length}B) \u2014 tunggu STX frame lengkap`
            );
          }
          return;
        }
        if (bufferAccumulator.length < etxIdx + 2) {
          if (voidFrameAcked) {
            console.log("[EDC VOID Post-ACK] frame STX belum lengkap (menunggu LRC)");
          }
          return;
        }
        if (voidFrameSent && !awaitingVoidResult) {
          return;
        }
        voidPhase = "RESULT";
        clearPostAckIdleTimer();
        const fullFrame = bufferAccumulator.subarray(stxIdx, etxIdx + 2);
        const payload = bufferAccumulator.subarray(stxIdx + 1, etxIdx);
        console.log("\n+===========================================================+");
        console.log(`|          RESPONSE EDC VOID - ${paymentType.padEnd(6, " ")}                   |`);
        console.log("+===========================================================+");
        console.log(
          `|  Full Frame (Hex)  : ${fullFrame.toString("hex").toUpperCase().substring(0, 37).padEnd(37, " ")}|`
        );
        console.log(
          `|  Payload (Hex)     : ${payload.toString("hex").toUpperCase().substring(0, 37).padEnd(37, " ")}|`
        );
        console.log("+===========================================================+\n");
        const parsed = parseDirectResponse(payload);
        console.log(
          `[EDC Manager] Parsed VOID respCode=${parsed.respCode} type=${parsed.transactionType || "-"} ref=${parsed.referenceNumber || "-"} date=${parsed.transactionDate || "-"} time=${parsed.transactionTime || "-"} amount/status=${parsed.terminalAmount || "-"} approval=${parsed.approvalCode || "-"} detail=${JSON.stringify(parsed.detail || "")}`
        );
        if (isShortTerminalError(payload) && parsed.respCode === "10" && parsed.detail.startsWith("ER")) {
          console.log("+===========================================================+");
          console.log("|                    TRANSAKSI VOID GAGAL                   |");
          console.log("+===========================================================+");
          console.log(`|  Payment Type      : ${paymentType.padEnd(37, " ")}|`);
          console.log(`|  Error Code        : 10-ER${" ".repeat(31)}|`);
          console.log(`|  Amount (Rp)       : ${amount.toLocaleString("id-ID").padEnd(37, " ")}|`);
          console.log("+===========================================================+\n");
          return finish({
            success: false,
            responseCode: "10",
            message: mapEdcErrorMessage(parsed.respCode, parsed.detail),
            rawHexResponse: fullFrame.toString("hex")
          });
        }
        writeVoidLink(Buffer.from([6]), `ack-void-result-${parsed.respCode}`);
        const isSuccess = parsed.respCode === "00";
        if (isSuccess) {
          console.log("+===========================================================+");
          console.log("|                 TRANSAKSI VOID BERHASIL                   |");
          console.log("+===========================================================+");
          console.log(`|  Payment Type      : ${paymentType.padEnd(37, " ")}|`);
          console.log(`|  Response Code     : ${parsed.respCode.padEnd(37, " ")}|`);
          console.log(`|  Amount (Rp)       : ${amount.toLocaleString("id-ID").padEnd(37, " ")}|`);
          console.log("|-----------------------------------------------------------|");
          console.log(`|  Reference Number  : ${(parsed.referenceNumber || "-").padEnd(37, " ")}|`);
          console.log(`|  RRN               : ${(parsed.rrn || "-").padEnd(37, " ")}|`);
          console.log(`|  Approval Code     : ${(parsed.approvalCode || "-").padEnd(37, " ")}|`);
          console.log(
            `|  Date / Time       : ${`${parsed.transactionDate || "-"} ${parsed.transactionTime || ""}`.trim().padEnd(37, " ")}|`
          );
          console.log(`|  Amount / Status   : ${(parsed.terminalAmount || "-").padEnd(37, " ")}|`);
          console.log("+===========================================================+\n");
        } else {
          console.log("+===========================================================+");
          console.log("|                  TRANSAKSI VOID GAGAL                     |");
          console.log("+===========================================================+");
          console.log(`|  Payment Type      : ${paymentType.padEnd(37, " ")}|`);
          console.log(`|  Response Code     : ${parsed.respCode.padEnd(37, " ")}|`);
          console.log(`|  Amount (Rp)       : ${amount.toLocaleString("id-ID").padEnd(37, " ")}|`);
          if (parsed.detail) {
            console.log(`|  Detail            : ${parsed.detail.substring(0, 37).padEnd(37, " ")}|`);
          }
          console.log("+===========================================================+\n");
        }
        return finish({
          success: isSuccess,
          responseCode: parsed.respCode,
          approvalCode: parsed.approvalCode || void 0,
          maskedCardNo: parsed.maskedCardNo || void 0,
          traceNumber: parsed.traceNumber || void 0,
          referenceNumber: parsed.referenceNumber || void 0,
          rrn: parsed.rrn || void 0,
          terminalId: parsed.terminalId || void 0,
          cardType: parsed.cardType || void 0,
          entryMode: parsed.entryMode || void 0,
          transactionType: parsed.transactionType || void 0,
          batchNumber: parsed.batchNumber || void 0,
          invoiceSequence: parsed.invoiceSequence || void 0,
          transactionDate: parsed.transactionDate || void 0,
          transactionTime: parsed.transactionTime || void 0,
          terminalAmount: parsed.terminalAmount || void 0,
          message: isSuccess ? "Void Transaksi EDC Berhasil" : parsed.detail || mapEdcErrorMessage(parsed.respCode, parsed.detail),
          rawHexResponse: fullFrame.toString("hex")
        });
      });
      port.on("error", (err) => {
        console.log("+===========================================================+");
        console.log("|                  KONEKSI SERIAL ERROR                     |");
        console.log("+===========================================================+");
        console.log(`|  Payment Type      : ${paymentType.padEnd(37, " ")}|`);
        console.log(`|  Error Message     : ${err.message.substring(0, 37).padEnd(37, " ")}|`);
        console.log("+===========================================================+\n");
        finish({
          success: false,
          message: `Koneksi Serial EDC Error: ${err.message}`
        });
      });
      port.on("close", () => {
        if (!isSettled) {
          console.log("+===========================================================+");
          console.log("|                PORT SERIAL TERPUTUS                       |");
          console.log("+===========================================================+");
          console.log(`|  Payment Type      : ${paymentType.padEnd(37, " ")}|`);
          console.log(`|  Port Path         : ${portPath.substring(0, 37).padEnd(37, " ")}|`);
          console.log("+===========================================================+\n");
          finish({
            success: false,
            message: "Port serial EDC terputus. Tutup script test, lalu coba void lagi di POS."
          });
        }
      });
      if (voidEnqFirst) {
        const enqFallbackMs = getVoidEnqFallbackMs();
        console.log(
          `[EDC Manager] Mode VOID ENQ-first (opsional) \u2014 tunggu ENQ dari EDC (fallback ${enqFallbackMs}ms)`
        );
        setTimeout(() => {
          if (!voidFrameSent) {
            console.log(
              `[EDC Manager] ENQ tidak diterima \u2014 kirim frame VOID (fallback ${enqFallbackMs}ms)`
            );
            sendVoidFrame();
          }
        }, enqFallbackMs);
      } else {
        const preSendDelayMs = (() => {
          const parsed = parseInt(process.env.EDC_PRE_SEND_DELAY_MS || "1500", 10);
          return Number.isNaN(parsed) ? 1500 : parsed;
        })();
        console.log(
          `[EDC Manager] Mode VOID direct-send (default, selaras SALE) \u2014 kirim frame setelah ${preSendDelayMs}ms`
        );
        setTimeout(() => sendVoidFrame(), preSendDelayMs);
      }
    });
  });
}

// electron/edc/src/edc/edc-settlement.ts
var import_serialport5 = require("serialport");
function buildIngenicoSettleFrame() {
  const ETX2 = 3;
  const settleVersionByte = parseHexByteEnv(process.env.EDC_SETTLE_VERSION, 1);
  const settleTypeByte = parseHexByteEnv(process.env.EDC_SETTLE_TYPE, 51);
  const settleSubTypeByte = parseHexByteEnv(process.env.EDC_SETTLE_SUB_TYPE, 48);
  const headerBuf = Buffer.from([settleVersionByte, settleTypeByte, settleSubTypeByte]);
  console.log("===========================================================");
  console.log("                EDC SETTLEMENT TRANSACTION FRAME           ");
  console.log("===========================================================");
  console.log("  Frame Structure (Danamon spec \xA76.5):");
  console.log(`    STX            : 0x02`);
  console.log(`    Version        : 0x${settleVersionByte.toString(16).toUpperCase().padStart(2, "0")}`);
  console.log(`    Type           : 0x${settleTypeByte.toString(16).toUpperCase().padStart(2, "0")}`);
  console.log(`    Sub Type       : 0x${settleSubTypeByte.toString(16).toUpperCase().padStart(2, "0")}`);
  console.log(`    ETX            : 0x${ETX2.toString(16).toUpperCase().padStart(2, "0")}`);
  console.log("-----------------------------------------------------------");
  const bodyBuf = Buffer.concat([headerBuf, Buffer.from([ETX2])]);
  const finalFrame = buildStxLrcFrame(bodyBuf);
  console.log(
    `  LRC/CRC          : 0x${finalFrame[finalFrame.length - 1].toString(16).toUpperCase().padStart(2, "0")}`
  );
  console.log("-----------------------------------------------------------");
  console.log(`  Complete Frame   : ${finalFrame.toString("hex").toUpperCase()}`);
  console.log("===========================================================\n");
  return finalFrame;
}
function settleEdcTransaction(host, params) {
  let { portPath, baudRate = getDefaultBaudRate(), timeoutMs = 12e4 } = params;
  portPath = normalizeSerialPortPath(portPath);
  return new Promise((resolve) => {
    let isSettled = false;
    let bufferAccumulator = Buffer.alloc(0);
    let settleFrameSent = false;
    let awaitingSettleResult = false;
    console.log("\n+-----------------------------------------------------------+");
    console.log(`|            MEMULAI SETTLEMENT BATCH EDC                   |`);
    console.log("+-----------------------------------------------------------+");
    console.log(`[EDC Manager] Serial Port   : ${portPath}`);
    console.log(`[EDC Manager] Baud Rate     : ${baudRate}`);
    console.log(`[EDC Manager] Timeout       : ${timeoutMs / 1e3}s
`);
    let activePort;
    try {
      const portOptions = {
        path: portPath,
        baudRate,
        dataBits: 8,
        parity: "none",
        stopBits: 1,
        autoOpen: false
      };
      activePort = host.createPort ? host.createPort(portOptions) : new import_serialport5.SerialPort(portOptions);
      host.setActivePort(activePort);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Gagal inisialisasi port";
      return resolve({
        success: false,
        message: `Gagal menginisialisasi Serial Port (${portPath}): ${message}`
      });
    }
    const timer = setTimeout(() => {
      if (!isSettled) {
        isSettled = true;
        console.log("+===========================================================+");
        console.log("|                  SETTLEMENT TIMEOUT                       |");
        console.log("+===========================================================+");
        console.log(
          `|  Timeout Duration  : ${(timeoutMs / 1e3).toString()}s${" ".repeat(34 - (timeoutMs / 1e3).toString().length)}|`
        );
        console.log("+===========================================================+\n");
        host.cleanup(activePort);
        resolve({
          success: false,
          message: `Waktu settlement di EDC habis (Timeout ${timeoutMs / 1e3}s). Settlement dibatalkan.`
        });
      }
    }, timeoutMs);
    const finish = (result) => {
      if (!isSettled) {
        isSettled = true;
        clearTimeout(timer);
        host.cleanup(activePort);
        resolve(result);
      }
    };
    const sendSettleFrame = () => {
      if (settleFrameSent || !host.getActivePort()?.isOpen) return;
      settleFrameSent = true;
      const frame = buildIngenicoSettleFrame();
      console.log(`[EDC Manager] Mengirim frame SETTLE ke EDC terminal...`);
      host.getActivePort().write(frame);
    };
    activePort.open((openErr) => {
      if (openErr) {
        console.log("+===========================================================+");
        console.log("|             GAGAL MEMBUKA SERIAL PORT                     |");
        console.log("+===========================================================+");
        console.log(`|  Port Path         : ${portPath.substring(0, 37).padEnd(37, " ")}|`);
        console.log(`|  Error Message     : ${openErr.message.substring(0, 37).padEnd(37, " ")}|`);
        console.log("+===========================================================+\n");
        return finish({
          success: false,
          message: `Tidak dapat membuka Serial Port EDC (${portPath}): ${openErr.message}`
        });
      }
      console.log(`[EDC Manager] Serial port berhasil dibuka
`);
      try {
        activePort.set({ dtr: true, rts: true });
      } catch (_) {
      }
      activePort.on("data", (chunk) => {
        bufferAccumulator = Buffer.concat([bufferAccumulator, chunk]);
        logRxChunk(chunk);
        if (chunk.includes(5)) {
          console.log("[EDC Manager] Menerima ENQ (0x05) dari EDC \u2014 balas ACK (terminal flow tetap jalan)");
          host.getActivePort()?.write(Buffer.from([6]));
          if (!settleFrameSent) {
            setTimeout(() => sendSettleFrame(), 100);
          }
        }
        if (bufferAccumulator.length === 1 && bufferAccumulator[0] === 4) {
          console.log("[EDC Manager] Menerima EOT (0x04) - Sesi berakhir");
          bufferAccumulator = Buffer.alloc(0);
          return;
        }
        if (bufferAccumulator.length === 1 && bufferAccumulator[0] === 6) {
          if (settleFrameSent) {
            console.log(`[EDC Manager] EDC merespons ACK (0x06) \u2014 menunggu proses settlement di terminal...`);
            awaitingSettleResult = true;
          } else {
            console.log("[EDC Manager] ACK sebelum frame \u2014 kirim frame SETTLE");
            sendSettleFrame();
          }
          bufferAccumulator = Buffer.alloc(0);
          return;
        }
        if (isBufferNak(bufferAccumulator)) {
          if (awaitingSettleResult) {
            console.log("+===========================================================+");
            console.log("|                   SETTLEMENT GAGAL                        |");
            console.log("+===========================================================+");
            console.log(`|  Error             : NAK dari terminal${" ".repeat(18)}|`);
            console.log("+===========================================================+\n");
            bufferAccumulator = Buffer.alloc(0);
            return finish({
              success: false,
              responseCode: "10",
              message: mapEdcErrorMessage("10", "ER")
            });
          }
          console.log("+===========================================================+");
          console.log("|                   SETTLEMENT GAGAL                        |");
          console.log("+===========================================================+");
          console.log(`|  Error             : NAK - Format/LRC Salah${" ".repeat(12)}|`);
          console.log(
            `|  Raw Hex           : ${bufferAccumulator.toString("hex").toUpperCase().substring(0, 37).padEnd(37, " ")}|`
          );
          console.log("+===========================================================+\n");
          return finish({
            success: false,
            message: "EDC menolak paket data (NAK - Format/LRC Salah)",
            rawHexResponse: bufferAccumulator.toString("hex")
          });
        }
        if (bufferAccumulator[0] === 6 && bufferAccumulator.length > 1) {
          if (settleFrameSent) {
            awaitingSettleResult = true;
            console.log(`[EDC Manager] EDC merespons ACK (0x06) + data tambahan`);
            console.log(`[EDC Manager] Menunggu proses settlement di terminal...`);
          }
          bufferAccumulator = bufferAccumulator.subarray(1);
        }
        const stxIdx = bufferAccumulator.indexOf(2);
        const etxIdx = bufferAccumulator.lastIndexOf(3);
        if (stxIdx === -1 || etxIdx === -1 || etxIdx <= stxIdx) {
          return;
        }
        if (bufferAccumulator.length < etxIdx + 2) {
          return;
        }
        if (settleFrameSent && !awaitingSettleResult) {
          return;
        }
        const fullFrame = bufferAccumulator.subarray(stxIdx, etxIdx + 2);
        const payload = bufferAccumulator.subarray(stxIdx + 1, etxIdx);
        console.log("\n+===========================================================+");
        console.log(`|          RESPONSE EDC SETTLEMENT                          |`);
        console.log("+===========================================================+");
        console.log(
          `|  Full Frame (Hex)  : ${fullFrame.toString("hex").toUpperCase().substring(0, 37).padEnd(37, " ")}|`
        );
        console.log(
          `|  Payload (Hex)     : ${payload.toString("hex").toUpperCase().substring(0, 37).padEnd(37, " ")}|`
        );
        console.log("+===========================================================+\n");
        const parsed = parseDirectResponse(payload);
        if (isShortTerminalError(payload) && parsed.respCode === "10" && parsed.detail.startsWith("ER")) {
          console.log("+===========================================================+");
          console.log("|                   SETTLEMENT GAGAL                        |");
          console.log("+===========================================================+");
          console.log(`|  Error Code        : 10-ER${" ".repeat(31)}|`);
          console.log("+===========================================================+\n");
          return finish({
            success: false,
            responseCode: "10",
            message: mapEdcErrorMessage(parsed.respCode, parsed.detail),
            rawHexResponse: fullFrame.toString("hex")
          });
        }
        writeLinkAck(host.getActivePort(), `settlement resp ${parsed.respCode}`);
        const isSuccess = parsed.respCode === "00";
        if (isSuccess) {
          console.log("+===========================================================+");
          console.log("|                  SETTLEMENT BERHASIL                      |");
          console.log("+===========================================================+");
          console.log(`|  Response Code     : ${parsed.respCode.padEnd(37, " ")}|`);
          console.log(`|  Message           : Settlement Batch Berhasil${" ".repeat(10)}|`);
          console.log("+===========================================================+\n");
        } else {
          console.log("+===========================================================+");
          console.log("|                   SETTLEMENT GAGAL                        |");
          console.log("+===========================================================+");
          console.log(`|  Response Code     : ${parsed.respCode.padEnd(37, " ")}|`);
          console.log("+===========================================================+\n");
        }
        return finish({
          success: isSuccess,
          responseCode: parsed.respCode,
          message: isSuccess ? "Settlement Batch EDC Berhasil" : mapEdcErrorMessage(parsed.respCode, parsed.detail),
          rawHexResponse: fullFrame.toString("hex")
        });
      });
      activePort.on("error", (err) => {
        console.log("+===========================================================+");
        console.log("|                  KONEKSI SERIAL ERROR                     |");
        console.log("+===========================================================+");
        console.log(`|  Error Message     : ${err.message.substring(0, 37).padEnd(37, " ")}|`);
        console.log("+===========================================================+\n");
        finish({
          success: false,
          message: `Koneksi Serial EDC Error: ${err.message}`
        });
      });
      activePort.on("close", () => {
        if (!isSettled) {
          console.log("+===========================================================+");
          console.log("|                PORT SERIAL TERPUTUS                       |");
          console.log("+===========================================================+");
          console.log(`|  Port Path         : ${portPath.substring(0, 37).padEnd(37, " ")}|`);
          console.log("+===========================================================+\n");
          finish({
            success: false,
            message: "Port serial EDC terputus. Tutup script test, lalu coba settle lagi."
          });
        }
      });
      setTimeout(() => sendSettleFrame(), getPreSendDelayMs());
    });
  });
}

// electron/edc/src/edc-manager.ts
var EDCManager = class _EDCManager {
  constructor() {
    this.activePort = null;
    this.activeOperation = null;
    this.state = "DISCONNECTED";
    this.recoveryInfo = null;
    this.savedDeviceIdentifier = null;
    this.opSeq = 0;
    this.statusListeners = [];
    // SerialPort class reference (default to real official package, overridable in unit tests)
    this.serialPortClass = import_serialport6.SerialPort;
    // Reconnect scheduler configuration
    this.backoffDelays = [1e3, 2e3, 5e3, 1e4];
    this.backoffIndex = 0;
    this.reconnectTimer = null;
    this.configuredPortPath = null;
  }
  setSerialPortClassForTesting(mockClass) {
    this.serialPortClass = mockClass;
  }
  resetSerialPortClass() {
    this.serialPortClass = import_serialport6.SerialPort;
  }
  static getInstance() {
    if (!_EDCManager.instance) {
      _EDCManager.instance = new _EDCManager();
    }
    return _EDCManager.instance;
  }
  /**
   * Centralized Concurrency & Transaction Guard:
   * Menjamin hanya ada 1 operasi serial yang aktif di satu waktu.
   */
  acquireOperationLock(type) {
    if (this.state === "RECOVERY_REQUIRED" && type === "PAYMENT") {
      return {
        error: "EDC_RECOVERY_REQUIRED: Transaksi sebelumnya belum tuntas atau status ambigu. Harap periksa struk fisik atau lakukan Inquiry/Reset Recovery sebelum melakukan pembayaran baru."
      };
    }
    if (this.activeOperation !== null) {
      return {
        error: `EDC_BUSY: Operasi EDC lain sedang berlangsung (${this.activeOperation.type}). Permintaan ditolak.`
      };
    }
    const opId = `op-${Date.now()}-${++this.opSeq}`;
    this.activeOperation = {
      id: opId,
      type,
      port: null
    };
    if (type === "PAYMENT") {
      this.setState("PAYMENT_PENDING");
    } else {
      this.setState("CONNECTING");
    }
    const host = this.createSerialHost(opId, type);
    return { opId, host };
  }
  /**
   * Memastikan cleanup hanya menutup instance port yang dimiliki operasi terkait
   * dan tidak pernah menutup port milik operasi lain.
   */
  releaseOperationLock(opId, portToClose) {
    if (!this.activeOperation || this.activeOperation.id !== opId) {
      if (portToClose && portToClose.isOpen) {
        try {
          portToClose.close();
        } catch (_) {
        }
      }
      return;
    }
    const currentPort = this.activeOperation.port;
    if (portToClose && currentPort && portToClose !== currentPort) {
      if (portToClose.isOpen) {
        try {
          portToClose.close();
        } catch (_) {
        }
      }
      return;
    }
    if (currentPort?.isOpen) {
      try {
        currentPort.close();
      } catch (_) {
      }
    }
    this.activeOperation = null;
    this.activePort = null;
    if (this.recoveryInfo?.required) {
      this.setState("RECOVERY_REQUIRED");
    } else {
      this.setState("DISCONNECTED");
    }
  }
  createSerialHost(opId, _opType) {
    return {
      createPort: (options) => new this.serialPortClass(options),
      getActivePort: () => {
        if (this.activeOperation && this.activeOperation.id === opId) {
          return this.activeOperation.port;
        }
        return null;
      },
      setActivePort: (port) => {
        if (this.activeOperation && this.activeOperation.id === opId) {
          this.activeOperation.port = port;
          this.activePort = port;
          if (port) {
            this.setState("CONNECTED");
          }
        }
      },
      cleanup: (portToClose) => {
        this.releaseOperationLock(opId, portToClose);
      },
      markRecoveryRequired: (info) => {
        this.setRecoveryRequired(info);
      },
      getOperationId: () => opId
    };
  }
  /**
   * P0: Menandai status transaksi menjadi RECOVERY_REQUIRED jika pembayaran
   * terputus setelah frame pembayaran dikirim namun hasil belum dipastikan.
   */
  setRecoveryRequired(info) {
    console.warn("[EDC Manager] P0 Safety Triggered: Status diubah ke RECOVERY_REQUIRED", info);
    this.recoveryInfo = {
      required: true,
      reason: info.reason,
      amount: info.amount,
      paymentType: info.paymentType,
      portPath: info.portPath,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      lastError: info.lastError
    };
    this.setState("RECOVERY_REQUIRED");
  }
  /**
   * P0: Prosedur reset recovery eksplisit oleh kasir/admin setelah melakukan
   * verifikasi fisik struk atau inquiry.
   */
  resetRecovery(reason, verificationMethod) {
    const trimmed = (reason || "").trim();
    if (!trimmed || trimmed.length < 5) {
      return {
        success: false,
        message: "Reset status recovery ditolak: Wajib menyertakan alasan rekonsiliasi yang valid (min 5 karakter)."
      };
    }
    console.log(`[EDC Manager] Reset recovery dieksekusi [${verificationMethod || "MANUAL"}]: ${trimmed}`);
    this.recoveryInfo = null;
    this.setState("DISCONNECTED");
    return { success: true, message: "Status recovery berhasil dibersihkan." };
  }
  /** Status dan diagnostik EDC */
  getStatus() {
    return {
      state: this.state,
      activePortPath: this.activeOperation?.port?.path || this.activePort?.path || null,
      activeOperation: this.activeOperation?.type || null,
      recovery: this.recoveryInfo,
      savedDevice: this.savedDeviceIdentifier
    };
  }
  onStatusChange(callback) {
    this.statusListeners.push(callback);
    try {
      callback(this.getStatus());
    } catch (_) {
    }
    return () => {
      this.statusListeners = this.statusListeners.filter((cb) => cb !== callback);
    };
  }
  setState(newState) {
    if (this.state !== newState) {
      console.log(`[EDC State] ${this.state} -> ${newState}`);
      this.state = newState;
      this.emitStatus();
    }
  }
  emitStatus() {
    const current = this.getStatus();
    for (const listener of this.statusListeners) {
      try {
        listener(current);
      } catch (err) {
        console.error("[EDC Manager] Status listener error:", err);
      }
    }
  }
  /** Mendapatkan daftar port serial yang terhubung ke Mac/PC */
  async listPorts() {
    const ports = await this.serialPortClass.list();
    const cuPorts = ports.filter((p) => p.path.includes("/cu."));
    const otherPorts = ports.filter((p) => !p.path.includes("/cu."));
    return [...cuPorts, ...otherPorts].map((p) => ({
      path: p.path,
      manufacturer: p.manufacturer || "",
      serialNumber: p.serialNumber || "",
      vendorId: p.vendorId || "",
      productId: p.productId || ""
    }));
  }
  /**
   * P1: Auto-detection dan resolver port berdasarkan identitas perangkat USB.
   * Tidak mengasumsikan serial number selalu ada.
   */
  async resolvePortPath(preferredPath, identifier) {
    let ports = [];
    try {
      ports = await this.serialPortClass.list();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        resolvedPath: null,
        matchedByIdentity: false,
        ambiguous: false,
        candidatePaths: [],
        error: `Gagal membaca daftar port serial: ${errorMsg}`
      };
    }
    const normPreferred = preferredPath ? normalizeSerialPortPath(preferredPath) : void 0;
    const targetId = identifier || this.savedDeviceIdentifier;
    if (targetId?.serialNumber && targetId.serialNumber.trim().length > 0) {
      const targetSn = targetId.serialNumber.trim().toLowerCase();
      const matches = ports.filter((p) => p.serialNumber && p.serialNumber.trim().toLowerCase() === targetSn);
      if (matches.length === 1) {
        return {
          resolvedPath: matches[0].path,
          matchedByIdentity: true,
          ambiguous: false,
          candidatePaths: [matches[0].path]
        };
      }
      if (matches.length > 1) {
        return {
          resolvedPath: null,
          matchedByIdentity: false,
          ambiguous: true,
          candidatePaths: matches.map((m) => m.path),
          error: `Ditemukan ${matches.length} perangkat dengan nomor serial USB yang identik.`
        };
      }
    }
    if (targetId?.vendorId && targetId?.productId) {
      const targetVid = targetId.vendorId.trim().toLowerCase();
      const targetPid = targetId.productId.trim().toLowerCase();
      const matches = ports.filter(
        (p) => p.vendorId?.trim().toLowerCase() === targetVid && p.productId?.trim().toLowerCase() === targetPid
      );
      if (matches.length === 1) {
        return {
          resolvedPath: matches[0].path,
          matchedByIdentity: true,
          ambiguous: false,
          candidatePaths: [matches[0].path]
        };
      }
      if (matches.length > 1) {
        if (normPreferred && matches.some((m) => m.path === normPreferred)) {
          return {
            resolvedPath: normPreferred,
            matchedByIdentity: true,
            ambiguous: false,
            candidatePaths: matches.map((m) => m.path)
          };
        }
        return {
          resolvedPath: null,
          matchedByIdentity: false,
          ambiguous: true,
          candidatePaths: matches.map((m) => m.path),
          error: `Ditemukan beberapa perangkat dengan VendorID/ProductID (${targetVid}:${targetPid}). Harap pilih port manual.`
        };
      }
    }
    if (normPreferred) {
      const found = ports.find((p) => arePortPathsEquivalent(p.path, normPreferred));
      if (found) {
        return {
          resolvedPath: found.path,
          matchedByIdentity: false,
          ambiguous: false,
          candidatePaths: [found.path]
        };
      }
    }
    if (normPreferred) {
      return {
        resolvedPath: null,
        matchedByIdentity: false,
        ambiguous: false,
        candidatePaths: ports.map((p) => p.path),
        error: `Port serial ${normPreferred} tidak ditemukan di sistem.`
      };
    }
    return {
      resolvedPath: null,
      matchedByIdentity: false,
      ambiguous: false,
      candidatePaths: ports.map((p) => p.path),
      error: "Port serial EDC belum dipilih."
    };
  }
  /** Simpan identitas hardware USB saat koneksi berhasil */
  async saveDeviceIdentityFromPort(portPath) {
    try {
      const ports = await this.serialPortClass.list();
      const normPath = normalizeSerialPortPath(portPath);
      const found = ports.find((p) => arePortPathsEquivalent(p.path, normPath));
      if (found && (found.vendorId || found.productId || found.serialNumber || found.manufacturer)) {
        this.savedDeviceIdentifier = {
          vendorId: found.vendorId || void 0,
          productId: found.productId || void 0,
          serialNumber: found.serialNumber || void 0,
          manufacturer: found.manufacturer || void 0
        };
        return this.savedDeviceIdentifier;
      }
    } catch (_) {
    }
    return null;
  }
  setSavedDeviceIdentifier(id) {
    this.savedDeviceIdentifier = id;
  }
  getSavedDeviceIdentifier() {
    return this.savedDeviceIdentifier;
  }
  /**
   * P1: Reconnect scheduler tunggal dengan exponential backoff:
   * 1s, 2s, 5s, 10s (capped di 10 detik).
   */
  startReconnectScheduler(targetPortPath) {
    if (targetPortPath) {
      this.configuredPortPath = targetPortPath;
    }
    if (this.reconnectTimer !== null) {
      return;
    }
    this.scheduleNextReconnect();
  }
  stopReconnectScheduler() {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.backoffIndex = 0;
  }
  scheduleNextReconnect() {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const delay = this.backoffDelays[this.backoffIndex];
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      await this.executeReconnectCheck();
    }, delay);
  }
  async executeReconnectCheck() {
    if (this.activeOperation !== null) {
      this.backoffIndex = Math.min(this.backoffIndex + 1, this.backoffDelays.length - 1);
      this.scheduleNextReconnect();
      return;
    }
    if (this.state === "RECOVERY_REQUIRED") {
      this.backoffIndex = Math.min(this.backoffIndex + 1, this.backoffDelays.length - 1);
      this.scheduleNextReconnect();
      return;
    }
    const resolution = await this.resolvePortPath(this.configuredPortPath || void 0, this.savedDeviceIdentifier);
    if (!resolution.resolvedPath || resolution.ambiguous) {
      this.setState("DISCONNECTED");
      this.backoffIndex = Math.min(this.backoffIndex + 1, this.backoffDelays.length - 1);
      this.scheduleNextReconnect();
      return;
    }
    const probeLock = this.acquireOperationLock("RECONNECT_PROBE");
    if ("error" in probeLock) {
      this.backoffIndex = Math.min(this.backoffIndex + 1, this.backoffDelays.length - 1);
      this.scheduleNextReconnect();
      return;
    }
    try {
      const probeResult = await this.testSerialConnection(
        resolution.resolvedPath,
        getDefaultBaudRate(),
        1500,
        probeLock.host
      );
      if (probeResult.success) {
        await this.saveDeviceIdentityFromPort(resolution.resolvedPath);
        this.setState("READY");
        this.backoffIndex = 0;
      } else {
        this.setState("DISCONNECTED");
        this.backoffIndex = Math.min(this.backoffIndex + 1, this.backoffDelays.length - 1);
        this.scheduleNextReconnect();
      }
    } finally {
      probeLock.host.cleanup();
    }
  }
  async processPayment(params) {
    if (this.state === "RECOVERY_REQUIRED") {
      return {
        success: false,
        responseCode: "RECOVERY_REQUIRED",
        message: "Transaksi sebelumnya belum tuntas atau status ambigu (RECOVERY_REQUIRED). Harap periksa struk fisik atau lakukan Inquiry/Reset Recovery sebelum melakukan pembayaran baru."
      };
    }
    if (params.connectionType !== "TCP_IP") {
      const configuredPath = params.portPath?.trim();
      const resolution = await this.resolvePortPath(configuredPath, this.savedDeviceIdentifier);
      if (resolution.ambiguous) {
        return {
          success: false,
          responseCode: "AMBIGUOUS_PORT",
          message: resolution.error || "Ditemukan beberapa port serial. Harap pilih port secara manual di Pengaturan EDC."
        };
      }
      if (resolution.resolvedPath) {
        if (configuredPath && resolution.resolvedPath !== normalizeSerialPortPath(configuredPath)) {
          console.log(`[EDC Manager] Port USB EDC terdeteksi berpindah: ${configuredPath} -> ${resolution.resolvedPath}`);
        }
        params.portPath = resolution.resolvedPath;
      } else if (!configuredPath) {
        return {
          success: false,
          message: resolution.error || "Port serial EDC belum dikonfigurasi."
        };
      }
    }
    const lockResult = this.acquireOperationLock("PAYMENT");
    if ("error" in lockResult) {
      return {
        success: false,
        responseCode: "EDC_BUSY",
        message: lockResult.error
      };
    }
    const { host } = lockResult;
    try {
      let res;
      if (params.paymentType === "QRIS") {
        res = await processQrisPayment(host, params);
      } else {
        res = await processDebitCreditPayment(host, params);
      }
      if (res.success && params.portPath) {
        await this.saveDeviceIdentityFromPort(params.portPath);
        this.setState("READY");
      }
      return res;
    } finally {
      host.cleanup();
    }
  }
  async voidTransaction(params) {
    const configuredPath = params.portPath?.trim();
    const resolution = await this.resolvePortPath(configuredPath, this.savedDeviceIdentifier);
    if (resolution.resolvedPath) {
      params.portPath = resolution.resolvedPath;
    }
    const lockResult = this.acquireOperationLock("VOID");
    if ("error" in lockResult) {
      return { success: false, responseCode: "EDC_BUSY", message: lockResult.error };
    }
    try {
      const res = await voidEdcTransaction(lockResult.host, params);
      if (res.success && params.portPath) {
        await this.saveDeviceIdentityFromPort(params.portPath);
        this.setState("READY");
      }
      return res;
    } finally {
      lockResult.host.cleanup();
    }
  }
  async settleTransaction(params) {
    const configuredPath = params.portPath?.trim();
    const resolution = await this.resolvePortPath(configuredPath, this.savedDeviceIdentifier);
    if (resolution.resolvedPath) {
      params.portPath = resolution.resolvedPath;
    }
    const lockResult = this.acquireOperationLock("SETTLEMENT");
    if ("error" in lockResult) {
      return { success: false, responseCode: "EDC_BUSY", message: lockResult.error };
    }
    try {
      const res = await settleEdcTransaction(lockResult.host, params);
      if (res.success && params.portPath) {
        await this.saveDeviceIdentityFromPort(params.portPath);
        this.setState("READY");
      }
      return res;
    } finally {
      lockResult.host.cleanup();
    }
  }
  async inquiryQrisLastTransaction(params) {
    if (params.connectionType !== "TCP_IP" && params.portPath) {
      const resolution = await this.resolvePortPath(params.portPath, this.savedDeviceIdentifier);
      if (resolution.resolvedPath) {
        params.portPath = resolution.resolvedPath;
      }
    }
    const lockResult = this.acquireOperationLock("INQUIRY");
    if ("error" in lockResult) {
      return { success: false, responseCode: "EDC_BUSY", message: lockResult.error };
    }
    try {
      const res = await inquiryQrisLastTransaction(lockResult.host, params);
      if (res.success) {
        if (this.state === "RECOVERY_REQUIRED") {
          this.recoveryInfo = null;
        }
        this.setState("READY");
      }
      return res;
    } finally {
      lockResult.host.cleanup();
    }
  }
  async inquiryQrisAnyTransaction(params) {
    if (params.connectionType !== "TCP_IP" && params.portPath) {
      const resolution = await this.resolvePortPath(params.portPath, this.savedDeviceIdentifier);
      if (resolution.resolvedPath) {
        params.portPath = resolution.resolvedPath;
      }
    }
    const lockResult = this.acquireOperationLock("INQUIRY");
    if ("error" in lockResult) {
      return { success: false, responseCode: "EDC_BUSY", message: lockResult.error };
    }
    try {
      const res = await inquiryQrisAnyTransaction(lockResult.host, params);
      if (res.success) {
        if (this.state === "RECOVERY_REQUIRED") {
          this.recoveryInfo = null;
        }
        this.setState("READY");
      }
      return res;
    } finally {
      lockResult.host.cleanup();
    }
  }
  /** Test koneksi ke EDC tanpa memproses transaksi — handshake ENQ saja. */
  async testConnection(params) {
    const timeoutMs = params.timeoutMs ?? 3e3;
    if (params.connectionType === "TCP_IP") {
      const ip = params.ipTerminal?.trim();
      const port = params.port;
      if (!ip || !port) {
        return { success: false, message: "IP Terminal dan Port wajib untuk koneksi TCP/IP." };
      }
      return this.testTcpConnection(ip, port, timeoutMs);
    }
    let configuredPath = params.portPath?.trim();
    const resolution = await this.resolvePortPath(configuredPath, this.savedDeviceIdentifier);
    if (resolution.ambiguous) {
      return {
        success: false,
        message: `Ditemukan beberapa perangkat serial (${resolution.candidatePaths.join(", ")}). Harap pilih port secara manual di Pengaturan EDC.`
      };
    }
    const portPath = resolution.resolvedPath || (configuredPath ? normalizeSerialPortPath(configuredPath) : null);
    if (!portPath) {
      return { success: false, message: resolution.error || "Port serial wajib dipilih untuk koneksi SERIAL." };
    }
    const lockResult = this.acquireOperationLock("TEST_CONNECTION");
    if ("error" in lockResult) {
      return { success: false, message: lockResult.error };
    }
    try {
      this.setState("CONNECTING");
      const res = await this.testSerialConnection(
        portPath,
        params.baudRate ?? getDefaultBaudRate(),
        timeoutMs,
        lockResult.host
      );
      let savedId = null;
      if (res.success) {
        savedId = await this.saveDeviceIdentityFromPort(portPath);
        this.setState("READY");
      } else {
        this.setState("DISCONNECTED");
      }
      return {
        ...res,
        deviceIdentifier: savedId || void 0
      };
    } finally {
      lockResult.host.cleanup();
    }
  }
  testTcpConnection(ip, port, timeoutMs) {
    return new Promise((resolve) => {
      let settled = false;
      const client = net4.createConnection({ host: ip, port }, () => {
        client.write(Buffer.from([5]));
      });
      const finish = (result) => {
        if (settled) return;
        settled = true;
        try {
          client.destroy();
        } catch (_) {
        }
        resolve(result);
      };
      client.setTimeout(timeoutMs);
      client.on("data", (data) => {
        finish({
          success: true,
          message: "POS berhasil terhubung ke EDC.",
          terminalId: extractTerminalIdFromPayload(data)
        });
      });
      client.on("timeout", () => {
        finish({ success: false, message: `Timeout: Unable to connect to ${ip}:${port}` });
      });
      client.on("error", (err) => {
        finish({ success: false, message: err.message || `Gagal koneksi ke ${ip}:${port}` });
      });
      client.on("close", () => {
        if (!settled) {
          finish({ success: false, message: `Koneksi ditutup sebelum respons diterima (${ip}:${port})` });
        }
      });
    });
  }
  testSerialConnection(portPath, baudRate, timeoutMs, host) {
    return new Promise((resolve) => {
      let settled = false;
      let port;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        try {
          if (port?.isOpen) port.close();
        } catch (_) {
        }
        resolve(result);
      };
      try {
        port = new this.serialPortClass({
          path: portPath,
          baudRate,
          dataBits: 8,
          parity: "none",
          stopBits: 1,
          autoOpen: false
        });
        if (host) {
          host.setActivePort(port);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Gagal inisialisasi port serial";
        return finish({ success: false, message });
      }
      const timer = setTimeout(() => {
        finish({ success: false, message: `Timeout: Tidak ada respons dari port serial ${portPath}` });
      }, timeoutMs);
      port.on("data", (data) => {
        clearTimeout(timer);
        finish({
          success: true,
          message: "POS berhasil terhubung ke EDC.",
          terminalId: extractTerminalIdFromPayload(data)
        });
      });
      port.on("error", (err) => {
        clearTimeout(timer);
        finish({ success: false, message: `Serial error: ${err.message}` });
      });
      port.open((openErr) => {
        if (openErr) {
          clearTimeout(timer);
          return finish({
            success: false,
            message: `Tidak dapat membuka port serial (${portPath}): ${openErr.message}`
          });
        }
        try {
          port.set({ dtr: true, rts: true });
        } catch (_) {
        }
        port.write(Buffer.from([5]));
      });
    });
  }
};
var edcManager = EDCManager.getInstance();
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  EDCManager,
  edcManager
});
