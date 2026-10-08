import { describe, expect, it } from "bun:test";
import { addCartLine, updateCartQuantity, toggleCartTopping, cartTotal, checkoutTotal, cartCount, lineKey } from "../src/features/orders/cart";

const menu = { id: "menu-a", name: "焼きそば", price: 300 };
const egg = { toppingId: "egg", toppingName: "卵", toppingPrice: 50 };
const sauce = { toppingId: "sauce", toppingName: "ソース", toppingPrice: 20 };

describe("shared POS and visitor cart", () => {
  it("merges only matching topping configurations and includes every topping in total", () => {
    let cart = addCartLine([], menu, [egg, sauce]);
    const original = cart;
    cart = addCartLine(cart, menu, [sauce, egg]);
    cart = addCartLine(cart, menu, []);
    expect(cart).toHaveLength(2);
    expect(cartCount(cart)).toBe(3);
    expect(cartTotal(cart)).toBe(1040);
    expect(original[0]!.quantity).toBe(1);
  });

  it("removes zero quantity rows and preserves the edited row's identity when toggling", () => {
    const cart = addCartLine([], menu, [egg]);
    const id = cart[0]!.lineId;
    const changed = toggleCartTopping(cart, id, { id: "egg", name: "卵", price: 50 });
    expect(changed[0]!.lineId).toBe(id);
    expect(cartTotal(changed)).toBe(300);
    expect(cartTotal(cart)).toBe(350);
    expect(updateCartQuantity(changed, id, -1)).toEqual([]);
  });

  it("does not collide on separator characters in identifiers", () => {
    expect(lineKey("a", ["b,c"])).not.toBe(lineKey("a", ["b", "c"]));
  });

  it("uses the saved preorder total so coupon discounts match the cashier amount", () => {
    const cart = addCartLine([], { id: "menu-a", name: "焼きそば", price: 150 }, []);
    expect(cartTotal(cart)).toBe(150);
    expect(checkoutTotal(cart, 50)).toBe(50);
    expect(checkoutTotal(cart, null)).toBe(150);
  });
});
