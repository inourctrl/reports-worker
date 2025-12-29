import dotenv from "dotenv";
dotenv.config();

export const apiConfig = {
  roofingcad: {
    apiBaseUrl: process.env.RFCAD_STRAPI_URL,
    apiToken: process.env.RFCAD_STRAPI_API_TOKEN,
  },
  "4hrsreport": {
    apiBaseUrl: process.env.HRSP4_STRAPI_URL,
    apiToken: process.env.HRSP4_STRAPI_API_TOKEN,
  },
};
