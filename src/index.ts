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
import { apiConfig } from "./config";

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

// Update multiple fields in the static schema of templateJson
export function updateStaticFieldsInTemplate<T = any>(
  template: T,
  updates: Record<string, any>,
): T {
  // Deep clone the template to avoid mutations
  const templateCopy = JSON.parse(JSON.stringify(template));

  // Check if basePdf and staticSchema exist
  if (
    !templateCopy.basePdf ||
    !Array.isArray(templateCopy.basePdf.staticSchema)
  ) {
    console.warn("Template does not have basePdf.staticSchema");
    return templateCopy;
  }

  // Update all fields
  Object.entries(updates).forEach(([fieldName, value]) => {
    const field = templateCopy.basePdf.staticSchema.find(
      (f: any) => f.name === fieldName,
    );

    if (field) {
      field.content = value;
    } else {
      console.warn(`Field "${fieldName}" not found in staticSchema`);
    }
  });

  return templateCopy;
}

const worker = new Worker(
  "reports",
  async (job) => {
    console.log("Received Job Request");
    let count = 0;
    const {
      templateId,
      orderRefId,
      orderId,
      suppressClientNotification,
      referrer,
    } = job.data;
    const pdfBuffers: Buffer[] = [];

    // API CONFIGS
    let STRAPI_URL;
    let STRAPI_API_TOKEN;

    switch (referrer) {
      case "roofingcad":
        STRAPI_URL = apiConfig["roofingcad"].apiBaseUrl;
        STRAPI_API_TOKEN = apiConfig["roofingcad"].apiToken;
        break;
      case "4hrsreport":
        STRAPI_URL = apiConfig["4hrsreport"].apiBaseUrl;
        STRAPI_API_TOKEN = apiConfig["4hrsreport"].apiToken;
        break;
    }

    const strapiApi = axios.create({
      baseURL: STRAPI_URL,
      headers: { Authorization: `Bearer ${STRAPI_API_TOKEN}` },
    });

    // Fetching compiled report data from the server
    const reportDataResponse = await strapiApi.get(
      `/api/bot/order-structures/${orderRefId}`,
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

    console.log("Received reportData");
    console.log(reportData);

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

        count += 1;

        // Update static schema in applicable templates
        const annotationsTemplate = updateStaticFieldsInTemplate(
          templates.annotationsTemplate,
          {
            structure_count: `${count}`,
            address: reportData.summary.address,
            logo: reportData.summary.logo.url,
          },
        );

        const imagesTemplate = updateStaticFieldsInTemplate(
          templates.imagesTemplate,
          {
            structure_count: `${count}`,
            address: reportData.summary.address,
            logo: reportData.summary.logo.url,
          },
        );

        // Generate Summary PDF (1st page)
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

        console.log("Summary PDF generated successfully");

        // Generate Roof Outline PDF
        const roofOutlinePdf = await generate({
          // @ts-ignore
          template: templates.roofOutlineTemplate,
          inputs: [
            {
              structure_count: count.toString(),
              remarks: structure?.notes,
              address: reportData.summary.address,
              logo: reportData.summary.logo.url,
              roof_outline_image: structure.roof_outline_image.url,
            },
          ],
          plugins: pdfmePlugins,
        });
        console.log("roofOutline PDF generated successfully");

        // Generate Annotations PDF
        const tableData = structure.annotations_table_data || [];
        const midpoint = Math.ceil(tableData.length / 2);

        const annotationsPdf = await generate({
          // @ts-ignore
          template: annotationsTemplate,
          inputs: [
            {
              annotations_table_data_1: tableData.slice(0, midpoint),
              annotations_table_data_2: tableData.slice(midpoint),
            },
          ],
          plugins: pdfmePlugins,
        });

        console.log("annotations PDF generated successfully");

        // Generate Images PDF
        const images: Record<string, string> = {};

        for (const [index, i] of (structure?.images ?? []).entries()) {
          images[`img_${index}`] = await urlToBase64(i);
        }

        const imagesPdf = await generate({
          // @ts-ignore
          template: imagesTemplate,
          inputs: [images],
        });

        pdfBuffers.push(Buffer.from(summaryPdf));
        pdfBuffers.push(Buffer.from(roofOutlinePdf));
        pdfBuffers.push(Buffer.from(annotationsPdf));
        pdfBuffers.push(Buffer.from(imagesPdf));
      }
    }

    // Merge all PDFs
    const mergedPdf = await merge(pdfBuffers);

    console.log("PDFs merged successfully");

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
    if (!suppressClientNotification)
      await strapiApi.put(`/api/bot/orders/${orderId}`, {
        // If suppressClientNotification = true, don't mark the order as completed
        status: "completed",
        internalStatus: "completed",
      });

    return uploadedFile.url;
  },
  {
    connection: {
      host: process.env.DRAGONFLY_HOST || "dragonfly",
      port: Number(process.env.DRAGONFLY_PORT) || 6379,
      password: process.env.DRAGONFLY_PASSWORD,
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
