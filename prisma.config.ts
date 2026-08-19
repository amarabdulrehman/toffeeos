// Prisma CLI config. This is used by `prisma migrate` / `prisma db push` / `prisma studio` only —
// it is NOT loaded by the running app. The app instantiates its own PrismaClient in
// src/server/db.ts against DATABASE_URL (the pooled, restricted `app_user` role), which is a
// deliberately different connection from the one below.
//
// DIRECT_URL is the unpooled connection on the Postgres owner role (Supabase: port 5432,
// "Direct connection" / "Session pooler" string). Migrations need DDL privileges the runtime
// app_user role does not have, and need a non-pgbouncer-transaction-mode connection to run
// multi-statement migrations reliably.
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env["DIRECT_URL"],
  },
});
