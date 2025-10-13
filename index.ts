import dotenv from "dotenv";
dotenv.config();

import { Worker } from "bullmq";
import { generate } from "@pdfme/generator";
import { merge } from "@pdfme/manipulator";
import axios from "axios";
import { FormData, Blob } from "formdata-node";
import {
  table,
  image,
  multiVariableText,
  text,
  rectangle,
  line,
} from "@pdfme/schemas";

import { ReportData } from "./types/structure";
import { ReportTemplate } from "./types/template";

const STRAPI_URL = process.env.STRAPI_URL;
const STRAPI_API_TOKEN = process.env.STRAPI_API_TOKEN;

const strapiApi = axios.create({
  baseURL: STRAPI_URL,
  headers: { Authorization: `Bearer ${STRAPI_API_TOKEN}` },
});

const pdfmePlugins = {
  Image: image,
  Table: table,
  Text: text,
  Rectangle: rectangle,
  Line: line,
  MultiVariableText: multiVariableText,
};

// Fetch S3 images and convert to base64
async function urlToBase64(url: string): Promise<string> {
  const res = await axios.get(url, { responseType: "arraybuffer" });
  const mime = res.headers["content-type"];
  const b64 = Buffer.from(res.data).toString("base64");
  return `data:${mime};base64,${b64}`;
}

const worker = new Worker(
  "reports",
  async (job) => {
    console.log("Received Job Request");
    const { templateId, orderRefId, orderId, user } = job.data;
    const pdfBuffers: Buffer[] = [];

    // Fetching compiled report data from the server
    const reportDataResponse = await strapiApi.get(
      `/api/bot/orders/${orderRefId}`,
    );
    const reportData = reportDataResponse?.data as ReportData;

    // Fetching template JSONs
    const templatesApiResponse = await strapiApi.get(
      `/api/report-templates/${templateId}`,
    );
    const templates = templatesApiResponse.data as ReportTemplate;

    // Handle base64 image conversions for summary logo
    if (reportData.summary?.logo?.url) {
      reportData.summary.logo = {
        url: await urlToBase64(reportData.summary.logo.url),
      };
    }

    // Handle base64 image conversions for each structure
    if (reportData.structures?.length) {
      for (const structure of reportData.structures) {
        if (structure.structure_image?.url) {
          structure.structure_image = {
            url: await urlToBase64(structure.structure_image.url),
          };
        }
        if (structure.roof_outline_image?.url) {
          structure.roof_outline_image = {
            url: await urlToBase64(structure.roof_outline_image.url),
          };
        }
        if (structure.images?.length) {
          const base64Images = await Promise.all(
            structure.images.map((u: string) => urlToBase64(u)),
          );
          structure.images = base64Images;
        }

        // Generate Summary PDF
        const summaryPdf = await generate({
          // @ts-ignore
          template: templates.summaryTemplate,
          inputs: [
            {
              ...reportData.summary,
              ...structure,
              logo: reportData.summary.logo.url,
              structure_image: structure.structure_image.url,
            },
          ],
          plugins: pdfmePlugins,
        });

        // Generate Roof Outline PDF
        const roofOutlinePdf = await generate({
          // @ts-ignore
          template: templates.roofOutlineTemplate,
          inputs: [
            {
              structure_count: 0,
              remarks: structure?.notes,
              address: reportData.summary.address,
              logo: reportData.summary.logo.url,
              roof_outline_image: structure.roof_outline_image.url,
            },
          ],
          plugins: pdfmePlugins,
        });

        // Generate Annotations PDF
        const tableData = structure.annotations_table_data || [];
        const midpoint = Math.ceil(tableData.length / 2);

        const annotationsPdf = await generate({
          // @ts-ignore
          template: templates.annotationsTemplate,
          inputs: [
            {
              structure_count: 0,
              address: reportData.summary.address,
              logo: reportData.summary.logo.url,
              roof_outline_image: structure.roof_outline_image.url,
              annotations_table_data_1: tableData.slice(0, midpoint),
              annotations_table_data_2: tableData.slice(midpoint),
            },
          ],
          plugins: pdfmePlugins,
        });

        pdfBuffers.push(Buffer.from(summaryPdf));
        pdfBuffers.push(Buffer.from(roofOutlinePdf));
        pdfBuffers.push(Buffer.from(annotationsPdf));
      }
    }

    // Merge all PDFs
    const mergedPdf = await merge(pdfBuffers);
    

    // Upload to Strapi Upload plugin
    const fileName = `OD-${orderId}.pdf`;
    const formData = new FormData();

    formData.append("ref", "api::order.order");
    formData.append("refId", orderId);
    formData.append("field", "outputs");

    formData.append(
      "files",
      new Blob([mergedPdf], { type: "application/pdf" }),
      fileName,
    );

    const uploadRes = await strapiApi.post("/api/upload", formData, {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    });

    const uploadedFile = uploadRes.data[0];

    
    // Update order status
    await strapiApi.put(`/api/bot/orders/${orderId}`, {
      status: "completed",
      internalStatus: "completed",
    });
    

    return uploadedFile.url;
  },
  {
    connection: {
      host: process.env.DRAGONFLY_HOST || "dragonfly",
      port: Number(process.env.DRAGONFLY_PORT) || 6379,
    },
    concurrency: 10,
  },
);

worker.on("completed", (job) =>
  console.log(`✅ Report job ${job.id} completed`),
);
worker.on("failed", (job, err) =>
  console.error(`❌ Job ${job?.id} failed:`, err),
);
