import { Worker } from "bullmq";
import { generate } from "@pdfme/generator";
import { merge } from "@pdfme/manipulator";
import axios from "axios";
import FormData from "form-data";

const STRAPI_URL = process.env.STRAPI_URL;
const STRAPI_API_TOKEN = process.env.STRAPI_API_TOKEN;

const strapiApi = axios.create({
  baseURL: STRAPI_URL,
  headers: { Authorization: `Bearer ${STRAPI_API_TOKEN}` },
});

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
    const { templates, dynamicOrderData, user } = job.data;

    const pdfBuffers: Buffer[] = [];

    // Handle base64 image conversions
    if (dynamicOrderData.summary?.logo?.url) {
      dynamicOrderData.summary.logo = {
        url: await urlToBase64(dynamicOrderData.summary.logo.url),
      };
    }
    if (dynamicOrderData.roofOutline?.image?.url) {
      dynamicOrderData.roofOutline.image = {
        url: await urlToBase64(dynamicOrderData.roofOutline.image.url),
      };
    }
    if (dynamicOrderData.images?.data?.length) {
      const base64Images = await Promise.all(
        dynamicOrderData.images.data.map((u: string) => urlToBase64(u))
      );
      dynamicOrderData.images.data = base64Images;
    }

    // Generate PDFs
    for (const [key, templateJSON] of Object.entries(templates)) {
      if (!templateJSON) continue;
      const data = dynamicOrderData[key];
      if (!data) continue;

      const pdf = await generate({
        template: templateJSON,
        inputs: [data],
      });

      pdfBuffers.push(Buffer.from(pdf));
    }

    // Merge all PDFs
    const mergedPdf = await merge(pdfBuffers);

    // Upload to Strapi Upload plugin
    const fileName = `report-${user.id}-${Date.now()}.pdf`;
    const formData = new FormData();
    formData.append(
      "files",
      new Blob([mergedPdf], { type: "application/pdf" }),
      fileName
    );

    const uploadRes = await strapiApi.post("/upload", formData, {
      headers: formData.getHeaders(),
    });

    const uploadedFile = uploadRes.data[0];

    // Save reference in report-file collection
    await strapiApi.post("/api/report-files", {
      data: { user: user.id, file: uploadedFile.id },
    });

    // Email user
    await strapiApi.post("/api/email", {
      to: user.email,
      subject: "Your report is ready",
      text: `Download it here: ${uploadedFile.url}`,
    });

    return uploadedFile.url;
  },
  {
    connection: {
      host: process.env.DRAGONFLY_HOST || "dragonfly",
      port: Number(process.env.DRAGONFLY_PORT) || 6379,
    },
  }
);

worker.on("completed", (job) =>
  console.log(`✅ Report job ${job.id} completed`)
);
worker.on("failed", (job, err) =>
  console.error(`❌ Job ${job?.id} failed:`, err)
);
