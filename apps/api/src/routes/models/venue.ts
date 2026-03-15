import { Elysia } from "elysia";
import {
  createVenueSchema,
  updateVenueSchema,
  venueListQuerySchema,
} from "@community-os/shared/validators";

export const venueModel = new Elysia({ name: "model.venue" }).model({
  "venue.create": createVenueSchema,
  "venue.update": updateVenueSchema,
  "venue.listQuery": venueListQuerySchema,
});
