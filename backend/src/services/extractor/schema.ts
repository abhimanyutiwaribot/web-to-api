import { z } from "zod";

export const ProductSchema = z.object({
  type: z.literal("product"),
  title: z.string().describe("The name of the product"),
  price: z.coerce.string().optional().describe("Price with currency symbol"),
  rating: z.coerce.string().optional().describe("Rating out of 5, e.g., 4.5/5"),
  description: z.string().optional().describe("A brief description of the product"),
  images: z.array(z.string()).optional().describe("List of image URLs"),
  specifications: z.record(z.string(), z.any()).optional().describe("Key-value pairs of technical specs")
}).passthrough();

export const ListingItemSchema = z.object({
  title: z.string().describe("The name or title of the item"),
  price: z.coerce.string().optional(),
  link: z.string().optional().describe("Direct link to the item detail page"),
  image: z.string().optional().describe("Thumbnail or main image URL"),
  rating: z.coerce.string().optional(),
  description: z.string().optional().describe("Brief summary of the item"),
}).passthrough();

export const ListingSchema = z.object({
  type: z.literal("listing"),
  items: z.array(ListingItemSchema),
  pagination: z.object({
    currentPage: z.coerce.number().optional(),
    totalPages: z.coerce.number().optional(),
    nextUrl: z.string().optional()
  }).optional()
}).passthrough();

export const ArticleSchema = z.object({
  type: z.literal("article"),
  title: z.string(),
  author: z.string().optional(),
  publishedDate: z.coerce.string().optional().describe("Date of publication"),
  content: z.string().describe("The main core text/Markdown content of the article"),
  tags: z.array(z.string()).optional(),
  image: z.string().optional()
}).passthrough();

export const BaseSchema = z.object({
  type: z.literal("unknown")
}).passthrough();

export const ExtractionSchema = z.discriminatedUnion("type", [
  ProductSchema,
  ListingSchema,
  ArticleSchema,
  BaseSchema
]);

export type ExtractionType = z.infer<typeof ExtractionSchema>;
