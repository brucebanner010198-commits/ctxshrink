"""Order pricing and discount logic for the checkout service."""

import logging
from decimal import Decimal
from typing import Optional

logger = logging.getLogger(__name__)

TAX_RATE = Decimal("0.0825")


class OrderService:
    """Coordinates order pricing, discounts, and cancellation."""

    def __init__(self, repository):
        self.repository = repository

    def total(self, order_id: str) -> Optional[Decimal]:
        """Return the order total including tax, or None if not found."""
        order = self.repository.get(order_id)
        if order is None:
            return None
        items = order.items
        subtotal = sum(item.price * item.qty for item in items)
        tax = subtotal * TAX_RATE
        logger.debug("computed subtotal=%s tax=%s", subtotal, tax)
        return subtotal + tax

    def apply_discount(self, order_id, code):
        # TODO: support stacked discount codes
        order = self.repository.get(order_id)
        discount = self.repository.get_discount(code)
        if discount is None:
            raise ValueError("unknown discount code")
        if discount.expired:
            raise ValueError("discount expired")
        order.discount = discount
        self.repository.save(order)
        return order

    def cancel(self, order_id):
        order = self.repository.get(order_id)
        order.status = "cancelled"
        self.repository.save(order)
        return order


class Repository:
    def __init__(self, store):
        self.store = store

    def get(self, order_id):
        return self.store.get(order_id)

    def get_discount(self, code):
        return self.store.discounts.get(code)

    def save(self, order):
        self.store.orders[order.id] = order
        return order
