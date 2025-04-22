-- Add runtime column to functions table
ALTER TABLE functions ADD COLUMN runtime VARCHAR(20) DEFAULT 'docker';

-- Add runtime column to container_pool table
ALTER TABLE container_pool ADD COLUMN runtime VARCHAR(20) DEFAULT 'docker'; 