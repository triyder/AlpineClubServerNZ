-- Communication Portal: the sanitised rich body a club may send with a shared
-- post.
--
-- Additive and nullable. Every existing row keeps rendering from "content",
-- which stays authoritative, so nothing is rewritten and no old client breaks:
-- a client that does not know the column simply never selects it.
ALTER TABLE "posts" ADD COLUMN "body_html" VARCHAR(20000);
