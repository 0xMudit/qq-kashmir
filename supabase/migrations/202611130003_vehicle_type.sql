ALTER TABLE qq_kashmir.beta_vehicles
ADD COLUMN IF NOT EXISTS vehicle_type TEXT NOT NULL DEFAULT 'car'
CHECK (vehicle_type IN ('car', 'truck', 'bus'));
