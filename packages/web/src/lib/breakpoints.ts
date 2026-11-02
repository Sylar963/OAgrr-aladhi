// Width alone misclassifies devices: a landscape phone is wider than 768px but has room for
// only one desktop table row, and a portrait iPad Air would get a desktop table with its strike
// column off-screen. Touch screens use the mobile layout until they are genuinely roomy.
export const MOBILE_QUERY =
  '(max-width: 768px), (max-width: 1023px) and (pointer: coarse), (max-height: 500px) and (pointer: coarse)';

export const DESKTOP_QUERY =
  '(min-width: 769px) and (pointer: fine), (min-width: 1024px) and (min-height: 501px)';
