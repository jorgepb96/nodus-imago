// Ready-made properties for historical photographs: the photographic process
// and the (inferred) type of camera, from the 19th century to digital. Each
// option has a short definition (used by the AI as a classification
// criterion) and its Wikipedia article, opened from an info icon. Article
// titles were checked against Wikipedia; when Spanish has no article the
// English one is used.

import type { Language } from "./language";

export type TemplateLanguage = Language;

export interface TemplateOption {
  es: string;
  en: string;
  fr: string;
  color: string;
  /** Short definition with dates, in both languages. */
  def: Record<TemplateLanguage, string>;
  /** Wikipedia article titles; es and fr fall back to en when absent. */
  wiki?: { es?: string; fr?: string; en: string };
}

export interface PropertyTemplate {
  id: "photo-process" | "camera-type";
  name: Record<TemplateLanguage, string>;
  /** General classification criteria for the AI. */
  criteria: Record<TemplateLanguage, string>;
  /** Most tags the AI may choose. */
  maxTags: number;
  options: TemplateOption[];
}

// Colours by period: 19th-century processes warm, silver gelatin neutral,
// colour processes vivid, digital blue.
const C19 = "#b45309",
  C19B = "#92400e",
  PRINT = "#a16207",
  SILVER = "#6b7280",
  COLOUR = "#db2777",
  INSTANT = "#7c3aed",
  DIGITAL = "#2563eb",
  NONE = "#9ca3af";

const PROCESSES: TemplateOption[] = [
  { es: "Heliografía", en: "Heliography", fr: "Héliographie", color: C19B, wiki: { es: "Heliografía", fr: "Héliographie", en: "Heliography" },
    def: { es: "Primer proceso fotográfico (Niépce, 1820-1830): betún de Judea sobre metal o vidrio, imagen muy tenue.", en: "First photographic process (Niépce, 1820s): bitumen on metal or glass, a very faint image.", fr: "Premier procédé photographique (Niépce, 1820-1830) : bitume de Judée sur métal ou verre, image très ténue." } },
  { es: "Daguerrotipo", en: "Daguerreotype", fr: "Daguerréotype", color: C19B, wiki: { es: "Daguerrotipo", fr: "Daguerréotype", en: "Daguerreotype" },
    def: { es: "Imagen única sobre plancha de cobre plateada, espejada, que cambia de positivo a negativo según el ángulo; suele ir en estuche (1839-1860).", en: "Unique image on a silvered copper plate, mirror-like, flipping between positive and negative with the angle; usually cased (1839-1860).", fr: "Image unique sur plaque de cuivre argentée, spéculaire, qui passe du positif au négatif selon l'angle ; souvent présentée dans un écrin (1839-1860)." } },
  { es: "Calotipo", en: "Calotype", fr: "Calotype", color: C19B, wiki: { es: "Calotipo", fr: "Calotype", en: "Calotype" },
    def: { es: "Negativo de papel de Talbot y sus copias: imagen suave con la fibra del papel visible (1841-1860).", en: "Talbot's paper negative and its prints: soft image with visible paper fibres (1841-1860).", fr: "Négatif papier de Talbot et ses épreuves : image douce où la fibre du papier reste visible (1841-1860)." } },
  { es: "Papel a la sal", en: "Salt print", fr: "Papier salé", color: C19, wiki: { es: "Papel a la sal", en: "Salt print" },
    def: { es: "Copia mate sin capa aglutinante, tonos marrón rojizo, imagen dentro de las fibras del papel (1840-1860).", en: "Matte print without a binder, reddish-brown tones, image within the paper fibres (1840-1860).", fr: "Épreuve mate sans couche de liant, tons brun rougeâtre, image prise dans les fibres du papier (1840-1860)." } },
  { es: "Copia a la albúmina", en: "Albumen print", fr: "Épreuve à l'albumine", color: C19, wiki: { es: "Copia a la albúmina", en: "Albumen print" },
    def: { es: "Copia con clara de huevo, brillo suave, tonos sepia o púrpura, a menudo amarillenta y montada en cartón (1850-1900); típica de tarjetas de visita y vistas de viaje.", en: "Egg-white print, soft gloss, sepia or purple tones, often yellowed and mounted on card (1850-1900); typical of cartes de visite and travel views.", fr: "Épreuve à l'albumen (blanc d'œuf), brillant doux, tons sépia ou pourpre, souvent jaunie et montée sur carton (1850-1900) ; typique des cartes de visite et des vues de voyage." } },
  { es: "Negativo de colodión húmedo", en: "Wet collodion negative", fr: "Négatif au collodion humide", color: C19, wiki: { es: "Colodión húmedo", en: "Collodion process" },
    def: { es: "Negativo sobre vidrio con colodión, bordes irregulares por el vertido a mano (1851-1880).", en: "Glass negative coated with collodion, uneven edges from hand pouring (1851-1880).", fr: "Négatif sur verre enduit de collodion, bords irréguliers dus à l'application à la main (1851-1880)." } },
  { es: "Ambrotipo", en: "Ambrotype", fr: "Ambrotype", color: C19, wiki: { es: "Ambrotipia", fr: "Ambrotype", en: "Ambrotype" },
    def: { es: "Colodión sobre vidrio que parece positivo sobre fondo oscuro; imagen única, en estuche (1854-1870).", en: "Collodion on glass seen as a positive against a dark backing; unique, cased (1854-1870).", fr: "Collodion sur verre qui apparaît en positif sur fond sombre ; image unique, en écrin (1854-1870)." } },
  { es: "Ferrotipo", en: "Tintype", fr: "Ferrotype", color: C19, wiki: { es: "Ferrotipo", fr: "Ferrotype", en: "Tintype" },
    def: { es: "Colodión sobre chapa de hierro lacada en negro, imagen única y oscura; retrato popular y ambulante (1856-1930).", en: "Collodion on black-lacquered iron, a unique dark image; popular and street portraiture (1856-1930).", fr: "Collodion sur tôle de fer laquée de noir, image unique et sombre ; portrait populaire et ambulant (1856-1930)." } },
  { es: "Cianotipia", en: "Cyanotype", fr: "Cyanotype", color: "#1d4ed8", wiki: { es: "Cianotipia", fr: "Cyanotype", en: "Cyanotype" },
    def: { es: "Copia de color azul de Prusia, mate (desde 1842); también planos y pruebas de aficionado.", en: "Prussian-blue matte print (from 1842); also blueprints and amateur proofs.", fr: "Épreuve mate bleu de Prusse (depuis 1842) ; aussi plans et épreuves d'amateur." } },
  { es: "Platinotipia", en: "Platinum print", fr: "Platinotypie", color: PRINT, wiki: { es: "Platinotipia", en: "Platinum print" },
    def: { es: "Copia mate de platino o paladio, gama de grises muy amplia y estable (1873-1930).", en: "Matte platinum or palladium print with a very long, stable tonal range (1873-1930).", fr: "Épreuve mate au platine ou au palladium, gamme de gris très étendue et stable (1873-1930)." } },
  { es: "Calitipia", en: "Kallitype", fr: "Kallitype", color: PRINT, wiki: { es: "Calitipia", en: "Kallitype" },
    def: { es: "Copia de hierro y plata, parecida a la platinotipia pero más marrón (1889-1930).", en: "Iron-silver print similar to platinum but browner (1889-1930).", fr: "Épreuve au fer et à l'argent, proche de la platinotypie mais plus brune (1889-1930)." } },
  { es: "Marrón Van Dyke", en: "Van Dyke brown", fr: "Brun Van Dyke", color: PRINT, wiki: { es: "Marrón Van Dyke", en: "Van Dyke brown (printing)" },
    def: { es: "Copia de hierro y plata de tono marrón intenso, a menudo artesanal (desde 1895).", en: "Iron-silver print in a deep brown, often handmade (from 1895).", fr: "Épreuve au fer et à l'argent d'un brun intense, souvent artisanale (depuis 1895)." } },
  { es: "Copia al carbón", en: "Carbon print", fr: "Épreuve au charbon", color: PRINT, wiki: { es: "Impresión al carbón", en: "Carbon print" },
    def: { es: "Pigmento en gelatina con ligero relieve, muy estable, cualquier color (1864-1940, incluido el carbro).", en: "Pigment in gelatine with slight relief, very stable, any colour (1864-1940, including carbro).", fr: "Pigment dans de la gélatine avec léger relief, très stable, toutes couleurs (1864-1940, carbro compris)." } },
  { es: "Goma bicromatada", en: "Gum bichromate", fr: "Gomme bichromatée", color: PRINT, wiki: { es: "Goma bicromatada", fr: "Gomme bichromatée", en: "Gum printing" },
    def: { es: "Pigmento en goma arábiga, aspecto pictórico y pinceladas (pictorialismo, 1894-1920).", en: "Pigment in gum arabic, painterly look with brush marks (pictorialism, 1894-1920).", fr: "Pigment dans de la gomme arabique, aspect pictural avec traces de pinceau (pictorialisme, 1894-1920)." } },
  { es: "Bromóleo y óleo", en: "Bromoil and oil print", fr: "Bromoil et procédé à l'huile", color: PRINT, wiki: { es: "Bromóleo", en: "Oil print process" },
    def: { es: "Tinta grasa aplicada a mano sobre una copia de gelatina, aspecto de grabado o pintura (1904-1930).", en: "Greasy ink hand-applied over a gelatine print, looks like an etching or painting (1904-1930).", fr: "Encre grasse appliquée à la main sur une épreuve à la gélatine, aspect de gravure ou de peinture (1904-1930)." } },
  { es: "Woodburytipia", en: "Woodburytype", fr: "Woodburytypie", color: PRINT, wiki: { es: "Woodburytipia", en: "Woodburytype" },
    def: { es: "Fotomecánica de tono continuo con relieve de gelatina pigmentada, en libros ilustrados (1866-1900).", en: "Continuous-tone photomechanical print in pigmented gelatine relief, in illustrated books (1866-1900).", fr: "Photomécanique à tons continus en relief de gélatine pigmentée, dans les livres illustrés (1866-1900)." } },
  { es: "Fototipia (colotipia)", en: "Collotype", fr: "Phototypie (collotypie)", color: PRINT, wiki: { es: "Fototipia", fr: "Collotypie", en: "Collotype" },
    def: { es: "Fotomecánica en tinta con grano reticulado fino y sin trama; postales y libros (1870-1940).", en: "Ink photomechanical print with a fine reticulated grain and no screen; postcards and books (1870-1940).", fr: "Photomécanique à l'encre, grain réticulé fin et sans trame ; cartes postales et livres (1870-1940)." } },
  { es: "Fotograbado", en: "Photogravure", fr: "Photogravure", color: PRINT, wiki: { es: "Fotograbado", fr: "Photogravure", en: "Photogravure" },
    def: { es: "Grabado en hueco a partir de una fotografía, tinta de tono rico con grano de aguatinta (1879-1940).", en: "Intaglio print from a photograph, rich ink tones with aquatint grain (1879-1940).", fr: "Gravure en creux d'après une photographie, tons d'encre riches avec grain d'aquatinte (1879-1940)." } },
  { es: "Fotocromo", en: "Photochrom", fr: "Photochrome", color: COLOUR, wiki: { es: "Fotocromo", fr: "Photochrome", en: "Photochrom" },
    def: { es: "Litografía en color a partir de un negativo, colores suaves aplicados por planchas; vistas turísticas (1890-1910).", en: "Colour lithograph from a negative, soft colours from several stones; tourist views (1890-1910).", fr: "Lithographie en couleurs d'après un négatif, couleurs douces appliquées par plusieurs pierres ; vues touristiques (1890-1910)." } },
  { es: "Semitono (fotomecánica)", en: "Halftone", fr: "Similigravure (photomécanique)", color: SILVER, wiki: { es: "Semitono (impresión)", fr: "Similigravure", en: "Halftone" },
    def: { es: "Reproducción impresa en tinta con trama de puntos visible al aumentar; prensa, libros y postales (desde 1880).", en: "Ink reproduction with a dot screen visible under magnification; press, books and postcards (from 1880).", fr: "Reproduction imprimée à l'encre avec trame de points visible au grossissement ; presse, livres et cartes postales (depuis 1880)." } },
  { es: "Tarjeta postal fotográfica", en: "Real photo postcard", fr: "Carte postale photographique", color: SILVER, wiki: { es: "Tarjeta postal", en: "Real photo postcard" },
    def: { es: "Copia de gelatina de plata en papel con reverso de postal, sin trama de puntos (1900-1950).", en: "Gelatin silver print on postcard-backed paper, no dot screen (1900-1950).", fr: "Épreuve à la gélatine d'argent sur papier au dos de carte postale, sans trame de points (1900-1950)." } },
  { es: "Negativo de gelatina sobre vidrio", en: "Gelatin dry plate negative", fr: "Négatif à la gélatine sur verre", color: SILVER, wiki: { es: "Gelatino-bromuro", fr: "Gélatino-bromure d'argent", en: "Photographic plate" },
    def: { es: "Placa seca de vidrio con gelatino-bromuro, industrial y de bordes rectos (1880-1950).", en: "Factory-made glass dry plate with gelatin bromide, straight edges (1880-1950).", fr: "Plaque sèche de verre au gélatino-bromure, industrielle, aux bords droits (1880-1950)." } },
  { es: "Negativo de película", en: "Film negative", fr: "Négatif sur film", color: SILVER, wiki: { es: "Película fotográfica", fr: "Pellicule photographique", en: "Photographic film" },
    def: { es: "Negativo flexible de nitrato, acetato o poliéster, en rollo u hoja (desde 1889).", en: "Flexible nitrate, acetate or polyester negative, roll or sheet (from 1889).", fr: "Négatif souple en nitrate, acétate ou polyester, en rouleau ou en feuille (depuis 1889)." } },
  { es: "Copia en gelatina de plata", en: "Gelatin silver print", fr: "Épreuve à la gélatine d'argent", color: SILVER, wiki: { es: "Papel fotográfico", fr: "Gélatino-bromure d'argent", en: "Gelatin silver print" },
    def: { es: "Copia en blanco y negro en papel con gelatina, neutra o virada; el proceso más común del siglo XX (desde 1880).", en: "Black-and-white print on gelatine-coated paper, neutral or toned; the most common 20th-century process (from 1880).", fr: "Épreuve en noir et blanc sur papier gélatiné, neutre ou virée ; le procédé le plus courant du XXe siècle (depuis 1880)." } },
  { es: "Diapositiva de linterna mágica", en: "Lantern slide", fr: "Plaque de lanterne magique", color: SILVER, wiki: { es: "Linterna mágica", fr: "Lanterne magique", en: "Magic lantern" },
    def: { es: "Positivo sobre vidrio para proyectar, a menudo con máscara y coloreado (1850-1950).", en: "Glass positive for projection, often masked and coloured (1850-1950).", fr: "Positif sur verre pour la projection, souvent masqué et colorié (1850-1950)." } },
  { es: "Placa Lippmann", en: "Lippmann plate", fr: "Plaque Lippmann", color: COLOUR, wiki: { en: "Lippmann plate" },
    def: { es: "Color interferencial sobre vidrio, iridiscente y muy raro (1891-1910).", en: "Interference colour on glass, iridescent and very rare (1891-1910).", fr: "Couleur interférentielle sur verre, irisée et très rare (1891-1910)." } },
  { es: "Autocromo", en: "Autochrome", fr: "Autochrome", color: COLOUR, wiki: { es: "Placa autocroma", fr: "Autochrome Lumière", en: "Autochrome Lumière" },
    def: { es: "Placa de vidrio en color con granos de fécula teñidos, aspecto puntillista (1907-1935).", en: "Colour glass plate of dyed starch grains, pointillist look (1907-1935).", fr: "Plaque de verre en couleurs à grains de fécule teints, aspect pointilliste (1907-1935)." } },
  { es: "Placas de trama (Dufaycolor, Finlay)", en: "Screen plates (Dufaycolor, Finlay)", fr: "Plaques à réseau (Dufaycolor, Finlay)", color: COLOUR, wiki: { es: "Dufaycolor", fr: "Dufaycolor", en: "Dufaycolor" },
    def: { es: "Color aditivo con retícula geométrica regular visible (1908-1950).", en: "Additive colour with a visible regular geometric screen (1908-1950).", fr: "Couleur additive avec réseau géométrique régulier visible (1908-1950)." } },
  { es: "Kodachrome", en: "Kodachrome", fr: "Kodachrome", color: COLOUR, wiki: { es: "Kodachrome", fr: "Kodachrome", en: "Kodachrome" },
    def: { es: "Diapositiva en color muy estable, rojos intensos (1935-2009).", en: "Very stable colour slide with strong reds (1935-2009).", fr: "Diapositive couleur très stable, rouges intenses (1935-2009)." } },
  { es: "Agfacolor", en: "Agfacolor", fr: "Agfacolor", color: COLOUR, wiki: { es: "Agfa Agfacolor", fr: "Agfacolor", en: "Agfacolor" },
    def: { es: "Película cromógena en color alemana, diapositiva y negativo (desde 1936).", en: "German chromogenic colour film, slide and negative (from 1936).", fr: "Film couleur chromogène allemand, diapositive et négatif (depuis 1936)." } },
  { es: "Ektachrome", en: "Ektachrome", fr: "Ektachrome", color: COLOUR, wiki: { fr: "Ektachrome", en: "Ektachrome" },
    def: { es: "Diapositiva cromógena que tiende a virar al magenta o al cian con el tiempo (desde 1946).", en: "Chromogenic slide that tends to shift to magenta or cyan with age (from 1946).", fr: "Diapositive chromogène qui tend à virer au magenta ou au cyan avec le temps (depuis 1946)." } },
  { es: "Copia cromógena (C-print)", en: "Chromogenic print (C-print)", fr: "Tirage chromogène (C-print)", color: COLOUR, wiki: { es: "Revelado cromogénico", en: "Chromogenic print" },
    def: { es: "Copia en color del siglo XX, la más habitual de laboratorio; amarillea o vira al magenta (desde 1942).", en: "The usual 20th-century lab colour print; yellows or shifts to magenta (from 1942).", fr: "Épreuve couleur du XXe siècle, la plus courante en laboratoire ; jaunit ou vire au magenta (depuis 1942)." } },
  { es: "Dye transfer", en: "Dye transfer", fr: "Dye transfer", color: COLOUR, wiki: { en: "Dye-transfer process" },
    def: { es: "Copia en color por transferencia de colorantes, colores muy saturados y estables (1946-1994).", en: "Colour print by dye transfer, very saturated and stable colours (1946-1994).", fr: "Épreuve couleur par transfert de colorants, couleurs très saturées et stables (1946-1994)." } },
  { es: "Cibachrome (Ilfochrome)", en: "Cibachrome (Ilfochrome)", fr: "Cibachrome (Ilfochrome)", color: COLOUR, wiki: { es: "Ilfochrome", fr: "Ilfochrome", en: "Ilfochrome" },
    def: { es: "Copia en color directa de diapositiva sobre poliéster muy brillante (1963-2012).", en: "Direct colour print from a slide on very glossy polyester (1963-2012).", fr: "Épreuve couleur directe à partir d'une diapositive sur polyester très brillant (1963-2012)." } },
  { es: "Fotografía instantánea (Polaroid)", en: "Instant photograph (Polaroid)", fr: "Photographie instantanée (Polaroid)", color: INSTANT, wiki: { es: "Película instantánea", en: "Instant film" },
    def: { es: "Copia única de revelado inmediato, con marco característico (desde 1948).", en: "Unique, self-developing print with a characteristic frame (from 1948).", fr: "Épreuve unique à développement immédiat, avec un cadre caractéristique (depuis 1948)." } },
  { es: "Coloreado a mano", en: "Hand-coloured", fr: "Colorié à la main", color: "#ea580c", wiki: { en: "Hand-colouring of photographs" },
    def: { es: "Color aplicado a mano sobre una fotografía en blanco y negro; se combina con el proceso de base.", en: "Colour applied by hand over a black-and-white photograph; combine with the base process.", fr: "Couleur appliquée à la main sur une photographie en noir et blanc ; se combine avec le procédé de base." } },
  { es: "Cliché-verre", en: "Cliché verre", fr: "Cliché-verre", color: PRINT, wiki: { es: "Cliché-verre", fr: "Cliché-verre", en: "Cliché verre" },
    def: { es: "Dibujo rayado sobre vidrio y copiado fotográficamente; imagen de trazo (desde 1839).", en: "Drawing scratched on glass and printed photographically; a line image (from 1839).", fr: "Dessin gravé sur verre et copié photographiquement ; image au trait (depuis 1839)." } },
  { es: "Sublimación de tinta", en: "Dye sublimation", fr: "Sublimation thermique", color: DIGITAL, wiki: { es: "Impresora de sublimación", en: "Dye-sublimation printing" },
    def: { es: "Copia digital por calor, tono continuo y superficie brillante (desde 1990).", en: "Digital print by heat, continuous tone and glossy surface (from 1990).", fr: "Épreuve numérique par chaleur, tons continus et surface brillante (depuis 1990)." } },
  { es: "Inyección de tinta (giclée)", en: "Inkjet (giclée)", fr: "Jet d'encre (giclée)", color: DIGITAL, wiki: { es: "Giclée", fr: "Giclée", en: "Giclée" },
    def: { es: "Impresión digital con gotas de tinta, a veces sobre papel de algodón (desde 1990).", en: "Digital print from ink droplets, sometimes on cotton paper (from 1990).", fr: "Impression numérique par gouttelettes d'encre, parfois sur papier coton (depuis 1990)." } },
  { es: "Fotografía digital", en: "Digital photograph", fr: "Photographie numérique", color: DIGITAL, wiki: { es: "Fotografía digital", fr: "Photographie numérique", en: "Digital photography" },
    def: { es: "Imagen nacida digital, sin original físico (desde 1990).", en: "Born-digital image with no physical original (from 1990).", fr: "Image née numérique, sans original physique (depuis 1990)." } },
  { es: "No determinable", en: "Undetermined", fr: "Indéterminable", color: NONE,
    def: { es: "No se puede decidir con seguridad a partir de la imagen.", en: "Cannot be decided safely from the image.", fr: "Impossible à déterminer avec certitude à partir de l'image." } },
];

const CAMERAS: TemplateOption[] = [
  { es: "Cámara oscura", en: "Camera obscura", fr: "Camera obscura", color: C19B, wiki: { es: "Cámara oscura", fr: "Camera obscura", en: "Camera obscura" },
    def: { es: "Caja oscura con orificio o lente, antecedente de la cámara (antes de 1839).", en: "Dark box with a hole or lens, the camera's forerunner (before 1839).", fr: "Boîte noire percée d'un orifice ou munie d'une lentille, ancêtre de l'appareil photo (avant 1839)." } },
  { es: "Cámara de daguerrotipo (de cajón corredero)", en: "Daguerreotype sliding-box camera", fr: "Appareil à daguerréotype (à boîtes coulissantes)", color: C19B, wiki: { es: "Daguerrotipo", en: "Daguerreotype" },
    def: { es: "Dos cajas de madera que deslizan para enfocar, exposiciones largas (1839-1860).", en: "Two wooden boxes sliding to focus, long exposures (1839-1860).", fr: "Deux boîtes en bois qui coulissent pour la mise au point, poses longues (1839-1860)." } },
  { es: "Cámara de gran formato de placas", en: "Large-format plate camera", fr: "Chambre grand format à plaques", color: C19, wiki: { es: "Cámara de fuelle", fr: "Chambre photographique", en: "Large format" },
    def: { es: "Cámara de trípode para placas grandes, gran nitidez y detalle; vistas y retratos de estudio (1850-1950).", en: "Tripod camera for large plates, great sharpness and detail; views and studio portraits (1850-1950).", fr: "Appareil sur trépied pour grandes plaques, grande netteté et grand détail ; vues et portraits de studio (1850-1950)." } },
  { es: "Cámara de campo plegable", en: "Field camera", fr: "Chambre de campagne pliante", color: C19, wiki: { en: "Field camera" },
    def: { es: "Gran formato de madera con fuelle, plegable para viajar; paisajes y arquitectura (1870-1950).", en: "Folding wooden large-format bellows camera for travel; landscapes and architecture (1870-1950).", fr: "Grand format en bois à soufflet, pliable pour le voyage ; paysages et architecture (1870-1950)." } },
  { es: "Cámara de banco óptico", en: "View camera (monorail)", fr: "Chambre à banc optique", color: C19, wiki: { es: "Cámara de fuelle", fr: "Chambre photographique", en: "View camera" },
    def: { es: "Gran formato con movimientos que corrigen la perspectiva: verticales rectas en arquitectura (desde 1900).", en: "Large format with movements that correct perspective: straight verticals in architecture (from 1900).", fr: "Grand format avec décentrements qui corrigent la perspective : verticales droites en architecture (depuis 1900)." } },
  { es: "Cámara estereoscópica", en: "Stereo camera", fr: "Appareil stéréoscopique", color: C19, wiki: { es: "Cámara estereoscópica", en: "Stereo camera" },
    def: { es: "Dos objetivos que producen un par de imágenes casi iguales lado a lado (1850-1960).", en: "Two lenses giving a pair of nearly identical side-by-side images (1850-1960).", fr: "Deux objectifs produisant deux images presque identiques côte à côte (1850-1960)." } },
  { es: "Cámara multiobjetivo (tarjeta de visita)", en: "Multi-lens carte de visite camera", fr: "Appareil multi-objectifs (carte de visite)", color: C19, wiki: { es: "Tarjeta de visita (retrato fotográfico)", fr: "Carte de visite (photographie)", en: "Carte de visite" },
    def: { es: "Varias imágenes pequeñas en una placa, retrato de estudio de cuerpo entero en cartón (1854-1900).", en: "Several small images on one plate, full-length studio portrait on card (1854-1900).", fr: "Plusieurs petites images sur une plaque, portrait de studio en pied sur carton (1854-1900)." } },
  { es: "Cámara panorámica", en: "Panoramic camera", fr: "Appareil panoramique", color: SILVER, wiki: { es: "Fotografía panorámica", fr: "Photographie panoramique", en: "Panoramic photography" },
    def: { es: "Imagen muy alargada horizontalmente, a veces por giro del objetivo (desde 1840).", en: "Very wide horizontal image, sometimes from a rotating lens (from 1840).", fr: "Image très allongée à l'horizontale, parfois par rotation de l'objectif (depuis 1840)." } },
  { es: "Cámara detective (de mano)", en: "Detective (hand) camera", fr: "Appareil détective (à main)", color: SILVER, wiki: { es: "Cámara oculta", en: "Hidden camera" },
    def: { es: "Cámara de mano disimulada o portátil para fotos espontáneas (1880-1910).", en: "Disguised or portable hand camera for candid shots (1880-1910).", fr: "Appareil à main dissimulé ou portatif pour photos prises sur le vif (1880-1910)." } },
  { es: "Cámara de cajón (box)", en: "Box camera", fr: "Appareil à boîte (box)", color: SILVER, wiki: { es: "Cámara de cajón", en: "Box camera" },
    def: { es: "Cámara de aficionado sencilla de enfoque fijo, como la Kodak Brownie; foto familiar algo blanda (1888-1960).", en: "Simple fixed-focus amateur camera such as the Kodak Brownie; slightly soft family snapshots (1888-1960).", fr: "Appareil d'amateur simple à mise au point fixe, comme le Kodak Brownie ; photo de famille un peu douce (1888-1960)." } },
  { es: "Cámara plegable de rollo", en: "Folding roll-film camera", fr: "Appareil pliant à pellicule en rouleau", color: SILVER, wiki: { es: "Cámara plegable", en: "Folding camera" },
    def: { es: "Cámara con fuelle que se pliega, de película en rollo; muy común entre aficionados (1900-1960).", en: "Folding bellows camera for roll film; very common among amateurs (1900-1960).", fr: "Appareil à soufflet qui se replie, pour pellicule en rouleau ; très courant chez les amateurs (1900-1960)." } },
  { es: "Cámara de prensa", en: "Press camera", fr: "Appareil de presse", color: SILVER, wiki: { en: "Press camera" },
    def: { es: "Gran formato de mano con flash, típica del fotoperiodismo (1910-1960).", en: "Hand-held large format with flash, typical of press photography (1910-1960).", fr: "Grand format à main avec flash, typique du photojournalisme (1910-1960)." } },
  { es: "Réflex de dos objetivos (TLR)", en: "Twin-lens reflex (TLR)", fr: "Reflex à deux objectifs (TLR)", color: SILVER, wiki: { es: "Cámara réflex de objetivos gemelos", fr: "Reflex à deux objectifs", en: "Twin-lens reflex camera" },
    def: { es: "Formato medio, negativo cuadrado de 6×6, vista desde la altura del pecho (1929-1980).", en: "Medium format, square 6×6 negative, viewed from chest height (1929-1980).", fr: "Moyen format, négatif carré de 6×6, visée à hauteur de poitrine (1929-1980)." } },
  { es: "Cámara de formato medio", en: "Medium-format camera", fr: "Appareil moyen format", color: SILVER, wiki: { es: "Formato medio", fr: "Moyen format", en: "Medium format" },
    def: { es: "Película de 120 en formatos de 6×4,5 a 6×9, gran calidad (desde 1900).", en: "120 film from 6×4.5 to 6×9, high quality (from 1900).", fr: "Film 120 en formats de 6×4,5 à 6×9, grande qualité (depuis 1900)." } },
  { es: "Cámara telemétrica", en: "Rangefinder camera", fr: "Appareil télémétrique", color: SILVER, wiki: { es: "Cámara telemétrica", en: "Rangefinder camera" },
    def: { es: "Cámara de 35 mm o formato medio con telémetro, como la Leica; reportaje y calle (desde 1925).", en: "35 mm or medium-format camera with a rangefinder, such as the Leica; reportage and street (from 1925).", fr: "Appareil 35 mm ou moyen format à télémètre, comme le Leica ; reportage et rue (depuis 1925)." } },
  { es: "Cámara de 35 mm", en: "35 mm camera", fr: "Appareil 35 mm", color: SILVER, wiki: { es: "Formato 135", fr: "Format 135", en: "135 film" },
    def: { es: "Película de 35 mm, proporción 3:2 y grano visible al ampliar (desde 1925).", en: "35 mm film, 3:2 frame and visible grain when enlarged (from 1925).", fr: "Film 35 mm, format 3:2 et grain visible à l'agrandissement (depuis 1925)." } },
  { es: "Réflex de un objetivo (SLR)", en: "Single-lens reflex (SLR)", fr: "Reflex mono-objectif (SLR)", color: SILVER, wiki: { es: "Cámara réflex de único objetivo", fr: "Reflex mono-objectif", en: "Single-lens reflex camera" },
    def: { es: "Réflex de película con objetivos intercambiables, teleobjetivos y angulares (1950-2005).", en: "Film reflex with interchangeable lenses, telephoto and wide angles (1950-2005).", fr: "Reflex argentique à objectifs interchangeables, téléobjectifs et grands-angles (1950-2005)." } },
  { es: "Cámara aérea", en: "Aerial camera", fr: "Appareil aérien", color: SILVER, wiki: { es: "Fotografía aérea", fr: "Photographie aérienne", en: "Aerial photography" },
    def: { es: "Vista desde globo, avión o dron, en picado o vertical (desde 1858).", en: "View from a balloon, aircraft or drone, oblique or vertical (from 1858).", fr: "Vue depuis un ballon, un avion ou un drone, oblique ou verticale (depuis 1858)." } },
  { es: "Cámara de reproducción", en: "Process camera", fr: "Appareil de reproduction", color: SILVER, wiki: { en: "Process camera" },
    def: { es: "Cámara de taller para copiar documentos, obras de arte o planos de frente (1880-1990).", en: "Workshop camera for frontal copies of documents, artworks or plans (1880-1990).", fr: "Appareil d'atelier pour copier de face des documents, œuvres d'art ou plans (1880-1990)." } },
  { es: "Cámara estenopeica", en: "Pinhole camera", fr: "Appareil sténopé", color: SILVER, wiki: { es: "Cámara estenopeica", fr: "Sténopé", en: "Pinhole camera" },
    def: { es: "Sin objetivo, solo un orificio: imagen blanda con profundidad de campo infinita.", en: "No lens, just a pinhole: soft image with infinite depth of field.", fr: "Sans objectif, juste un orifice : image douce avec profondeur de champ infinie." } },
  { es: "Cámara subminiatura (Minox)", en: "Subminiature camera (Minox)", fr: "Appareil subminiature (Minox)", color: SILVER, wiki: { en: "Subminiature photography" },
    def: { es: "Formato diminuto, muy granulado, a veces de espionaje (desde 1938).", en: "Tiny format, very grainy, sometimes for espionage (from 1938).", fr: "Format minuscule, très granuleux, parfois d'espionnage (depuis 1938)." } },
  { es: "Cámara instantánea", en: "Instant camera", fr: "Appareil instantané", color: INSTANT, wiki: { es: "Cámara instantánea", en: "Instant camera" },
    def: { es: "Polaroid y similares: copia única de revelado inmediato con marco (desde 1948).", en: "Polaroid and similar: unique self-developing print with a frame (from 1948).", fr: "Polaroid et similaires : épreuve unique à développement immédiat avec cadre (depuis 1948)." } },
  { es: "Cámara de cartucho (Instamatic, 110)", en: "Cartridge camera (Instamatic, 110)", fr: "Appareil à cartouche (Instamatic, 110)", color: COLOUR, wiki: { es: "Instamatic", fr: "Instamatic", en: "Instamatic" },
    def: { es: "Cámara de aficionado de cartucho, copias cuadradas o pequeñas en color (1963-1990).", en: "Amateur cartridge camera, small or square colour prints (1963-1990).", fr: "Appareil d'amateur à cartouche, petites épreuves couleur ou carrées (1963-1990)." } },
  { es: "Cámara compacta", en: "Point-and-shoot camera", fr: "Appareil compact", color: COLOUR, wiki: { es: "Cámara compacta", fr: "Appareil photographique compact", en: "Point-and-shoot camera" },
    def: { es: "Compacta de película automática con flash; foto familiar en color (1977-2005).", en: "Automatic compact film camera with flash; colour family snapshots (1977-2005).", fr: "Compact argentique automatique avec flash ; photo de famille en couleur (1977-2005)." } },
  { es: "Cámara de juguete (Holga, Diana)", en: "Toy camera (Holga, Diana)", fr: "Appareil jouet (Holga, Diana)", color: COLOUR, wiki: { es: "Toy camera", en: "Toy camera" },
    def: { es: "Óptica de plástico: viñeteado fuerte, desenfoque y fugas de luz.", en: "Plastic optics: heavy vignetting, blur and light leaks.", fr: "Optique en plastique : vignettage prononcé, flou et fuites de lumière." } },
  { es: "Cámara desechable", en: "Disposable camera", fr: "Appareil jetable", color: COLOUR, wiki: { es: "Cámara de fotos desechable", en: "Disposable camera" },
    def: { es: "Cámara de un solo uso con flash, color de laboratorio (desde 1986).", en: "Single-use camera with flash, lab colour (from 1986).", fr: "Appareil à usage unique avec flash, couleur de laboratoire (depuis 1986)." } },
  { es: "Sistema APS", en: "Advanced Photo System", fr: "Système APS", color: COLOUR, wiki: { es: "Advanced Photo System", fr: "Advanced Photo System", en: "Advanced Photo System" },
    def: { es: "Película APS con formatos clásico, HDTV y panorámico (1996-2011).", en: "APS film with classic, HDTV and panoramic formats (1996-2011).", fr: "Film APS aux formats classique, HDTV et panoramique (1996-2011)." } },
  { es: "Cámara subacuática", en: "Underwater camera", fr: "Appareil sous-marin", color: COLOUR, wiki: { es: "Fotografía subacuática", fr: "Photographie sous-marine", en: "Underwater photography" },
    def: { es: "Cámara estanca o con carcasa para fotografiar bajo el agua.", en: "Waterproof or housed camera for underwater pictures.", fr: "Appareil étanche ou sous caisson pour photographier sous l'eau." } },
  { es: "Cámara digital compacta", en: "Digital compact camera", fr: "Compact numérique", color: DIGITAL, wiki: { es: "Cámara digital", fr: "Appareil photographique numérique", en: "Digital camera" },
    def: { es: "Compacta digital de sensor pequeño (1994-2015).", en: "Small-sensor digital compact (1994-2015).", fr: "Compact numérique à petit capteur (1994-2015)." } },
  { es: "Cámara puente (bridge)", en: "Bridge camera", fr: "Appareil bridge", color: DIGITAL, wiki: { es: "Cámara compacta avanzada", en: "Bridge camera" },
    def: { es: "Digital con gran zoom fijo, aspecto de réflex (desde 1990).", en: "Digital with a long fixed zoom and an SLR-like body (from 1990).", fr: "Numérique à long zoom fixe, allure de reflex (depuis 1990)." } },
  { es: "Réflex digital (DSLR)", en: "Digital SLR (DSLR)", fr: "Reflex numérique (DSLR)", color: DIGITAL, wiki: { es: "Cámara réflex digital", fr: "Reflex numérique", en: "Digital single-lens reflex camera" },
    def: { es: "Réflex digital de objetivos intercambiables (desde 1999).", en: "Digital reflex with interchangeable lenses (from 1999).", fr: "Reflex numérique à objectifs interchangeables (depuis 1999)." } },
  { es: "Cámara sin espejo", en: "Mirrorless camera", fr: "Appareil hybride (sans miroir)", color: DIGITAL, wiki: { es: "Cámara sin espejo de objetivos intercambiables", fr: "Appareil photographique hybride", en: "Mirrorless camera" },
    def: { es: "Digital de objetivos intercambiables sin espejo réflex (desde 2008).", en: "Interchangeable-lens digital without a reflex mirror (from 2008).", fr: "Numérique à objectifs interchangeables sans miroir reflex (depuis 2008)." } },
  { es: "Teléfono móvil", en: "Camera phone", fr: "Téléphone mobile", color: DIGITAL, wiki: { es: "Teléfono con cámara fotográfica", en: "Camera phone" },
    def: { es: "Fotografía tomada con un móvil, a menudo con procesado automático (desde 2000).", en: "Photograph taken with a phone, often with automatic processing (from 2000).", fr: "Photographie prise avec un mobile, souvent avec traitement automatique (depuis 2000)." } },
  { es: "No determinable", en: "Undetermined", fr: "Indéterminable", color: NONE,
    def: { es: "No se puede inferir el tipo de cámara a partir de la imagen.", en: "The type of camera cannot be inferred from the image.", fr: "Impossible de déduire le type d'appareil à partir de l'image." } },
];

export const PROPERTY_TEMPLATES: PropertyTemplate[] = [
  {
    id: "photo-process",
    name: { es: "Proceso fotográfico", en: "Photographic process", fr: "Procédé photographique" },
    maxTags: 2,
    criteria: {
      es: "Identifica el proceso del objeto fotográfico por su aspecto: soporte (metal, vidrio, papel, película), color y tono, brillo, grano o trama de puntos, montaje y deterioro. Si el registro tiene fecha, no propongas procesos posteriores a ella. Puedes añadir «Coloreado a mano» junto al proceso de base. Si no se distingue con seguridad, elige «No determinable».",
      en: "Identify the process of the photographic object from its look: support (metal, glass, paper, film), colour and tone, gloss, grain or dot screen, mount and decay. If the record has a date, do not suggest processes later than it. You may add “Hand-coloured” next to the base process. If it cannot be told apart safely, choose “Undetermined”.",
      fr: "Identifiez le procédé de l'objet photographique d'après son aspect : support (métal, verre, papier, film), couleur et ton, brillant, grain ou trame de points, montage et dégradation. Si la fiche porte une date, ne proposez pas de procédés postérieurs. Vous pouvez ajouter «\u00a0Colorié à la main\u00a0» à côté du procédé de base. S'il est impossible de trancher avec certitude, choisissez «\u00a0Indéterminable\u00a0».",
    },
    options: PROCESSES,
  },
  {
    id: "camera-type",
    name: { es: "Tipo de cámara (inferido)", en: "Camera type (inferred)", fr: "Type d'appareil (déduit)" },
    maxTags: 1,
    criteria: {
      es: "Infiere la familia de cámara por los rasgos de la imagen: formato y proporción, par estereoscópico, nitidez y profundidad de campo, perspectiva corregida, viñeteado, grano y punto de vista. Si el registro tiene fecha, no propongas cámaras posteriores a ella. Es una inferencia: si no hay rasgos claros, elige «No determinable».",
      en: "Infer the family of camera from the image's features: format and proportions, stereo pair, sharpness and depth of field, corrected perspective, vignetting, grain and viewpoint. If the record has a date, do not suggest cameras later than it. It is an inference: without clear features, choose “Undetermined”.",
      fr: "Déduisez la famille d'appareil d'après les traits de l'image : format et proportions, paire stéréoscopique, netteté et profondeur de champ, perspective corrigée, vignettage, grain et point de vue. Si la fiche porte une date, ne proposez pas d'appareils postérieurs. Il s'agit d'une déduction : sans traits clairs, choisissez «\u00a0Indéterminable\u00a0».",
    },
    options: CAMERAS,
  },
];

const wikiUrl = (lang: TemplateLanguage, title: string) =>
  `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;

/** The Wikipedia article for an option in the interface language (or English). */
export function templateOptionLink(option: TemplateOption, language: string): string | null {
  if (!option.wiki) return null;
  if (language === "es" && option.wiki.es) return wikiUrl("es", option.wiki.es);
  if (language === "fr" && option.wiki.fr) return wikiUrl("fr", option.wiki.fr);
  return wikiUrl("en", option.wiki.en);
}

/** Everything needed to create the property in the interface language. */
export function buildTemplate(template: PropertyTemplate, language: string) {
  const lang: TemplateLanguage = language === "es" || language === "fr" ? language : "en";
  const options = template.options.map((o) => ({ label: o[lang], color: o.color }));
  const key = (o: TemplateOption) => o[lang].toLocaleLowerCase();
  return {
    name: template.name[lang],
    options,
    config: {
      aiEnabled: true,
      aiFreeTags: false,
      aiMaxTags: template.maxTags,
      aiCriteriaOn: true,
      aiCriteria: template.criteria[lang],
      aiDefinitionsOn: true,
      aiDefinitions: Object.fromEntries(template.options.map((o) => [key(o), o.def[lang]])),
      optionLinks: Object.fromEntries(
        template.options
          .map((o) => [key(o), templateOptionLink(o, lang)] as const)
          .filter((entry): entry is readonly [string, string] => !!entry[1]),
      ),
    },
  };
}
