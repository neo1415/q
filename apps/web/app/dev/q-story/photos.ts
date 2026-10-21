/**
 * The storyboard's photographs: Pexels, found through the repo's own port
 * (packages/q-daily, createPexelsDailyPhotos) and credited as Pexels asks.
 * The files are not in the repository: the page asks for
 * /dev/q-story/media/<key>.jpg, a path no server serves, and the recording
 * run answers it. Without an answer each tile shows a neutral "photo"
 * placeholder, which is the fallback the brief allows.
 */
export const PHOTOS = {
  desk: {
    alt: "A dimly lit modern office desk with a laptop, headphones, and speakers at 1:00 AM.",
    credit: "Photo by Julien Bachelet on Pexels",
  },
  m1: {
    alt: "Lively outdoor market with colorful fruit and vegetable stalls in an urban setting.",
    credit: "Photo by Алексей  Виноградов on Pexels",
  },
  m2: {
    alt: "High-quality glass bottles being processed on a factory production line.",
    credit: "Photo by Keegan Checks on Pexels",
  },
  m3: {
    alt: "Scientist in a lab coat handling test tubes under pink lighting, using a microscope.",
    credit: "Photo by Artem Podrez on Pexels",
  },
  m4: {
    alt: "Tractor harvesting rice in a lush field in Kon Tum, Vietnam.",
    credit: "Photo by Thái Trường Giang on Pexels",
  },
  m5: {
    alt: "Capture the beauty of an urban skyline at sunset with warm orange hues and silhouetted bui",
    credit: "Photo by Snapwire on Pexels",
  },
  m6: {
    alt: "From above unrecognizable female weaver in gray sweater sitting at wooden table with patte",
    credit: "Photo by https://kaboompics.com/ on Pexels",
  },
  m7: {
    alt: "Luminous night view of a bustling industrial port with cargo ships.",
    credit: "Photo by Oleksiy on Pexels",
  },
  m8: {
    alt: "Solar panels on tiled roofs of houses with chimneys, capturing clean energy.",
    credit: "Photo by Lena Netkach on Pexels",
  },
  m9: {
    alt: "Two workers handle a package in a spacious warehouse surrounded by shelves stocked with bo",
    credit: "Photo by Tiger Lily on Pexels",
  },
  m10: {
    alt: "Veterinary medical supplies including syringes, pills, and spray displayed on a table.",
    credit: "Photo by Tahir Xəlfəquliyev on Pexels",
  },
  m11: {
    alt: "Young man weaving on a loom in a traditional workshop with intricate fabric designs.",
    credit: "Photo by Greece-China  News on Pexels",
  },
  m12: {
    alt: "Bearded man taking notes in a modern coffee roastery, wearing an apron.",
    credit: "Photo by Antoni Shkraba on Pexels",
  },
  f1: {
    alt: "Concentrated senior male master in apron standing near table and buffing wooden surface wh",
    credit: "Photo by Andrea Piacquadio on Pexels",
  },
  f2: {
    alt: "Close-up of person counting cash with a calculator and paperwork on a desk.",
    credit: "Photo by Tima Miroshnichenko on Pexels",
  },
  f3: {
    alt: "A diverse group of colleagues having a lively discussion around a conference table in a mo",
    credit: "Photo by Alena Darmel on Pexels",
  },
  f4: {
    alt: "A florist with braided hair hands a bouquet to a happy customer in a flower shop.",
    credit: "Photo by Gustavo Fring on Pexels",
  },
  e1: {
    alt: "Close-up view of a complex industrial conveyor system inside a manufacturing facility.",
    credit: "Photo by Michael Li on Pexels",
  },
  e2: {
    alt: "Parked Isuzu trucks lined up in the city, ready for delivery. Ideal for transport and logi",
    credit: "Photo by Kamus Cheung on Pexels",
  },
  e3: {
    alt: "Spacious and contemporary mall interior with closed stores and escalator.",
    credit: "Photo by Andrew Patrick Photo on Pexels",
  },
} as const;

export type PhotoKey = keyof typeof PHOTOS;
