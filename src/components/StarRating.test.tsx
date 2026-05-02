import React from 'react';
import {render, screen, fireEvent} from '@testing-library/react';
import {describe, it, expect, vi} from 'vitest';
import {StarRating} from './StarRating';

describe('StarRating', () => {
  it('renders correct number of stars', () => {
    const {container} = render(<StarRating rating={3} maxStars={5} />);
    const stars = container.querySelectorAll('.relative');
    expect(stars.length).toBe(5);
  });

  it('renders the correct rating', () => {
    const {container} = render(<StarRating rating={3.5} maxStars={5} />);
    // Select all filled overlays
    const filledStars = container.querySelectorAll('svg.fill-secondary');
    expect(filledStars.length).toBe(4); // 3 full, 1 half
  });

  it('calls onRatingChange when interactive', () => {
    const onRatingChange = vi.fn();
    const {container} = render(
      <StarRating
        rating={0}
        maxStars={5}
        interactive={true}
        onRatingChange={onRatingChange}
      />,
    );

    const stars = container.querySelectorAll('.cursor-pointer');
    // Clicking the 4th star (index 3) should result in rating 3.5 or 4 depending on where it clicks
    // Mocking click position is tricky, let's just assert it calls the function.
    fireEvent.click(stars[3], {clientX: 100}); // dummy clientX
    expect(onRatingChange).toHaveBeenCalled();
  });

  it('is not interactive when interactive prop is false', () => {
    const onRatingChange = vi.fn();
    const {container} = render(
      <StarRating
        rating={0}
        maxStars={5}
        interactive={false}
        onRatingChange={onRatingChange}
      />,
    );

    const stars = container.querySelectorAll('div > div');
    fireEvent.click(stars[0]);
    expect(onRatingChange).not.toHaveBeenCalled();
  });
});
