import React from 'react';
import {render, fireEvent} from '@testing-library/react';
import {describe, it, expect, vi} from 'vitest';
import {StarRating} from './star-rating';

describe('StarRating UI component', () => {
  it('renders correct number of stars', () => {
    const {container} = render(<StarRating rating={3} maxStars={5} />);
    const stars = container.querySelectorAll('.relative');
    expect(stars.length).toBe(5);
  });

  it('renders filled overlays for ratings', () => {
    const {container} = render(<StarRating rating={3.5} maxStars={5} />);
    const filledStars = container.querySelectorAll('svg.fill-secondary');
    expect(filledStars.length).toBe(4); // 3 full, 1 half
  });

  it('triggers onRatingChange when clicked in interactive mode', () => {
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
    fireEvent.click(stars[2], {clientX: 100});
    expect(onRatingChange).toHaveBeenCalled();
  });
});
