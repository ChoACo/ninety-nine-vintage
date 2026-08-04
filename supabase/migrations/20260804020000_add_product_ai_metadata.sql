-- migration: add enhanced_title and hashtags to products
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS enhanced_title TEXT,
  ADD COLUMN IF NOT EXISTS hashtags TEXT[] DEFAULT '{}';

COMMENT ON COLUMN public.products.enhanced_title IS 'AI-generated enhanced product title';
COMMENT ON COLUMN public.products.hashtags IS 'AI-generated hashtags for the product';