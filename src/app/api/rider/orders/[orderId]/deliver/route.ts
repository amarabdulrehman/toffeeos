import { NextResponse } from "next/server";
import { defineHandler } from "@/server/handler";
import { markDelivered } from "@/server/delivery";

// No `input` schema here — this route accepts either multipart/form-data (photo proof) or JSON
// ({ code }) for OTP proof, so it parses the body itself based on content type instead of going
// through defineHandler's built-in JSON parsing.
export const POST = defineHandler({ permission: "delivery.confirmDropoff" }, async ({ session, params, req }) => {
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("photo");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "A photo file is required." }, { status: 400 });
    }
    const order = await markDelivered(session.tenantId, session.branchId, params.orderId, session.id, {
      method: "PHOTO",
      file,
    });
    return { order };
  }

  const body = await req.json().catch(() => ({}));
  const code = typeof body.code === "string" ? body.code : "";
  if (!code) {
    return NextResponse.json({ error: "A delivery code is required." }, { status: 400 });
  }
  const order = await markDelivered(session.tenantId, session.branchId, params.orderId, session.id, {
    method: "OTP",
    code,
  });
  return { order };
});
