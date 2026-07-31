-- Development and test rollback only. Production uses forward-fix migrations.
ALTER DEFAULT PRIVILEGES IN SCHEMA aggregator
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM aggregator_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA aggregator
  REVOKE SELECT ON TABLES FROM aggregator_readonly;

DROP SCHEMA IF EXISTS aggregator CASCADE;

-- Cluster-scoped NOLOGIN roles are deliberately retained. A database rollback
-- must not remove roles that another database in the same cluster may use.
