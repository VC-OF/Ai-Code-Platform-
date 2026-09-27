import { describe, it, expect } from 'vitest';
import { MAX_LIVE_TITLE, liveImages, liveMeals, livePokemon } from '@/lib/publicApis/liveItems';

describe('live example normalisation', () => {
  it('tolerates missing or malformed payloads', () => {
    for (const payload of [null, undefined, 'oops', 42, {}, { meals: null }, { results: 'x' }]) {
      expect(liveImages(payload)).toEqual([]);
      expect(liveMeals(payload)).toEqual([]);
      expect(livePokemon(payload)).toEqual([]);
    }
  });

  it('cleans meal names and validates ids and image URLs', () => {
    const meals = liveMeals({
      meals: [
        null,
        { idMeal: '52772', strMeal: 'Teriyaki\r\nChicken\u0007', strMealThumb: 'https://www.themealdb.com/t.jpg' },
        { idMeal: '../../x', strMeal: 'Path trick', strMealThumb: 'https://www.themealdb.com/p.jpg' },
        { idMeal: 52773, strMeal: '', strMealThumb: 'https://www.themealdb.com/e.jpg' },
        { idMeal: 52774, strMeal: 'y'.repeat(300), strMealThumb: 'data:image/png;base64,AAAA' },
      ],
    });
    expect(meals.map((m) => m.id)).toEqual(['52772', '52774']);
    expect(meals[0]).toMatchObject({ title: 'Teriyaki Chicken', image: 'https://www.themealdb.com/t.jpg', auth: 'none' });
    expect(meals[1].title).toHaveLength(MAX_LIVE_TITLE);
    expect(meals[1]).not.toHaveProperty('image');
  });

  it('keeps PokéAPI endpoints on pokeapi.co', () => {
    const pokemon = livePokemon({
      results: [
        { name: 'ditto', url: 'https://pokeapi.co/api/v2/pokemon/132/' },
        { name: 'mew', url: 'https://attacker.example/api/v2/pokemon/151/' },
        { name: 'mewtwo', url: 'https://user:pass@pokeapi.co/api/v2/pokemon/150/' },
      ],
    });
    expect(pokemon).toEqual([expect.objectContaining({ title: 'ditto', endpoint: 'https://pokeapi.co/api/v2/pokemon/132/' })]);
  });

  it('applies the limits after filtering', () => {
    const images = Array.from({ length: 20 }, (_, i) => ({ id: String(i), download_url: `https://picsum.photos/id/${i}/10/10` }));
    expect(liveImages([{ id: 'bad id!' }, ...images], 3).map((img) => img.id)).toEqual(['0', '1', '2']);
  });
});
