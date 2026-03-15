import { z } from "zod";

export const createVenueSchema = z.object({
  name: z.string().min(1).max(200),
  address: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
  country: z.string().length(2).optional(),
  postalCode: z.string().max(20).optional(),
  mapsUrl: z.string().url().optional(),
  capacity: z.number().int().positive().optional(),
  costPerDay: z.number().positive().optional(),
  costNotes: z.string().max(500).optional(),
  notes: z.string().max(1000).optional(),
});

export const updateVenueSchema = createVenueSchema.partial();

export const venueListQuerySchema = z.object({
  q: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type CreateVenueInput = z.infer<typeof createVenueSchema>;
export type UpdateVenueInput = z.infer<typeof updateVenueSchema>;
export type VenueListQuery = z.infer<typeof venueListQuerySchema>;
