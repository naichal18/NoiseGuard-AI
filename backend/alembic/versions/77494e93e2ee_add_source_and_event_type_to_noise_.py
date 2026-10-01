"""add source and event type to noise readings

Revision ID: 77494e93e2ee
Revises: bb69425e2eb2
Create Date: 2026-09-03 18:54:23.744133

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "77494e93e2ee"
down_revision: Union[str, Sequence[str], None] = "bb69425e2eb2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "noise_readings",
        sa.Column(
            "source",
            sa.String(length=20),
            nullable=False,
            server_default=sa.text("'sensor'"),
        ),
    )

    op.add_column(
        "noise_readings",
        sa.Column(
            "event_type",
            sa.String(length=50),
            nullable=False,
            server_default=sa.text("'NORMAL_ACTIVITY'"),
        ),
    )

    op.create_index(
        "ix_noise_readings_source",
        "noise_readings",
        ["source"],
        unique=False,
    )

    op.create_index(
        "ix_noise_readings_event_type",
        "noise_readings",
        ["event_type"],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(
        "ix_noise_readings_event_type",
        table_name="noise_readings",
    )

    op.drop_index(
        "ix_noise_readings_source",
        table_name="noise_readings",
    )

    op.drop_column("noise_readings", "event_type")
    op.drop_column("noise_readings", "source")