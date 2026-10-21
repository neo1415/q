/**
 * Q Story pictures, curated from Pexels by
 * scripts/q-pitch/curate-story-pictures.mjs (generated: do not edit by hand).
 * Free to use with credit; the credit shows under each picture on screen.
 * Static files only: the story never fetches a picture while it plays.
 */
export type StoryPicture = {
  readonly n: number;
  readonly file: string;
  readonly alt: string;
  readonly photographer: string;
  readonly source: string;
};

export const STORY_PICTURES: readonly StoryPicture[] = [
  {
    n: 1,
    file: "/q-pitch/story/pictures/01.jpg",
    alt: "Markets",
    photographer: "Pixabay",
    source: "https://www.pexels.com/photo/numbers-on-monitor-534216/",
  },
  {
    n: 2,
    file: "/q-pitch/story/pictures/02.jpg",
    alt: "A factory floor",
    photographer: "EqualStock IN",
    source:
      "https://www.pexels.com/photo/female-textile-workers-in-factory-setting-31112178/",
  },
  {
    n: 3,
    file: "/q-pitch/story/pictures/03.jpg",
    alt: "A laboratory",
    photographer: "Artem Podrez",
    source:
      "https://www.pexels.com/photo/scientist-holding-container-with-vials-8533136/",
  },
  {
    n: 4,
    file: "/q-pitch/story/pictures/04.jpg",
    alt: "A farm",
    photographer: "Mwesigwa Joel",
    source:
      "https://www.pexels.com/photo/harvesting-corn-in-the-fields-of-uganda-38668660/",
  },
  {
    n: 5,
    file: "/q-pitch/story/pictures/05.jpg",
    alt: "A city",
    photographer: "Luis Quintero",
    source:
      "https://www.pexels.com/photo/aerial-shot-of-panama-city-in-panama-14840760/",
  },
  {
    n: 6,
    file: "/q-pitch/story/pictures/06.jpg",
    alt: "A studio",
    photographer: "Ron Lach",
    source:
      "https://www.pexels.com/photo/people-working-in-an-atelier-9850083/",
  },
  {
    n: 7,
    file: "/q-pitch/story/pictures/07.jpg",
    alt: "A port",
    photographer: "Oleksiy",
    source:
      "https://www.pexels.com/photo/industrial-night-scene-with-cargo-ships-39621567/",
  },
  {
    n: 8,
    file: "/q-pitch/story/pictures/08.jpg",
    alt: "Solar energy",
    photographer: "Tom Fisk",
    source: "https://www.pexels.com/photo/directly-above-solar-farm-9893731/",
  },
  {
    n: 9,
    file: "/q-pitch/story/pictures/09.jpg",
    alt: "A shop",
    photographer: "Demetra Ioannidou",
    source:
      "https://www.pexels.com/photo/smiling-shopkeeper-with-homemade-preserves-34674788/",
  },
  {
    n: 10,
    file: "/q-pitch/story/pictures/10.jpg",
    alt: "A clinic",
    photographer: "https://kaboompics.com/",
    source:
      "https://www.pexels.com/photo/crop-man-doctor-with-stethoscope-and-medicine-4021800/",
  },
  {
    n: 11,
    file: "/q-pitch/story/pictures/11.jpg",
    alt: "A software team",
    photographer: "cottonbro studio",
    source:
      "https://www.pexels.com/photo/men-sitting-at-the-desks-in-an-office-and-using-computers-6804068/",
  },
  {
    n: 12,
    file: "/q-pitch/story/pictures/12.jpg",
    alt: "A market",
    photographer: "Quý Nguyễn",
    source:
      "https://www.pexels.com/photo/street-stall-with-agricultural-products-17341188/",
  },
  {
    n: 13,
    file: "/q-pitch/story/pictures/13.jpg",
    alt: "A desk at night",
    photographer: "Julien Bachelet",
    source:
      "https://www.pexels.com/photo/black-digital-alarm-clock-at-1-00-880989/",
  },
  {
    n: 14,
    file: "/q-pitch/story/pictures/14.jpg",
    alt: "Years of building",
    photographer: "Alax Matias",
    source:
      "https://www.pexels.com/photo/carpenter-working-in-workshop-using-table-saw-28513058/",
  },
  {
    n: 15,
    file: "/q-pitch/story/pictures/15.jpg",
    alt: "Their own money in",
    photographer: "https://kaboompics.com/",
    source:
      "https://www.pexels.com/photo/man-sitting-on-sofa-and-holding-money-6328893/",
  },
  {
    n: 16,
    file: "/q-pitch/story/pictures/16.jpg",
    alt: "Payroll day",
    photographer: "Tima Miroshnichenko",
    source:
      "https://www.pexels.com/photo/businessman-fashion-man-suit-6694545/",
  },
  {
    n: 17,
    file: "/q-pitch/story/pictures/17.jpg",
    alt: "A first customer",
    photographer: "cottonbro studio",
    source: "https://www.pexels.com/photo/two-men-shaking-hands-6127092/",
  },
  {
    n: 18,
    file: "/q-pitch/story/pictures/18.jpg",
    alt: "Logistics",
    photographer: "Tiger Lily",
    source:
      "https://www.pexels.com/photo/workers-walking-along-aisle-in-warehouse-4487383/",
  },
  {
    n: 19,
    file: "/q-pitch/story/pictures/19.jpg",
    alt: "Retail",
    photographer: "Andrew Patrick Photo",
    source:
      "https://www.pexels.com/photo/a-large-shopping-mall-with-escalators-and-glass-doors-27452443/",
  },
  {
    n: 20,
    file: "/q-pitch/story/pictures/20.jpg",
    alt: "An established business",
    photographer: "女子 正真",
    source:
      "https://www.pexels.com/photo/urban-factory-landscape-with-smokestack-32955243/",
  },
];

/** Pictures 1-12 tile the montage (#7). */
export const MONTAGE_PICTURES = STORY_PICTURES.filter((p) => p.n <= 12);

export function storyPicture(n: number): StoryPicture | null {
  return STORY_PICTURES.find((p) => p.n === n) ?? null;
}
