/**
 * Instruções enviadas aos modelos generativos. Todas repetem a mesma regra: é foto de anúncio imobiliário,
 * então a estrutura real do imóvel não pode ser inventada nem alterada.
 */
const KEEP = 'This is a real-estate listing photograph. Keep the exact architecture, room geometry, walls, ceilings, windows, doors, floors, proportions, camera angle and composition unchanged. Do not add or remove structural elements. The result must be photorealistic, with no text, logos or watermarks. Return only the edited image.';

export const PROMPTS = {
  enhance: () => `Enhance this photo for a property listing: balanced exposure and white balance, natural vivid colors, gentle contrast, crisp detail and reduced noise. Do not add, remove or change any object. ${KEEP}`,
  lighting: () => `Improve the lighting of this interior/exterior photo: brighten dark areas, balance shadows and highlights, recover detail in windows without blowing them out, keep the light natural and realistic. Do not add, remove or change any object. ${KEEP}`,
  removeObject: (what: string) => `Remove the following from the photo and realistically fill the area with the surrounding surfaces (floor, wall, grass, sky…): ${what}. Change nothing else in the image. ${KEEP}`,
  removeFurniture: () => `Remove all furniture, rugs, decorations, loose items and clutter from this room so it appears empty, showing the bare floor, walls and windows exactly as they are. Keep built-in fixtures (kitchen cabinets, sanitary ware, closets, lighting fixtures). ${KEEP}`,
  virtualStage: (style: string) => `Virtually stage this empty room with tasteful, realistic ${style} furniture and decor appropriate to the room type (sofa, rug, tables, plants, artwork…), correctly scaled and lit to match the room. Do not block doors, windows or walkways. ${KEEP}`,
  replaceSky: () => `Replace only the sky with a natural clear blue sky with a few soft clouds, matching the scene's lighting and blending the horizon and edges cleanly. Change nothing else. ${KEEP}`,
} as const;
