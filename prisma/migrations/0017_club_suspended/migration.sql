-- A club an administrator has switched off (Unapprove on /clubs). Distinct from
-- REJECTED, which means "never accepted": a SUSPENDED club can be re-approved
-- and keeps its lodges, its keys and its history meanwhile. Every status other
-- than APPROVED is already refused by the API, so nothing else changes here.
ALTER TYPE "ClubStatus" ADD VALUE 'SUSPENDED';
