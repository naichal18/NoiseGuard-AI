"""create alerts table

Revision ID: 9f40c81c2a71
Revises: 77494e93e2ee
Create Date: 2026-10-01

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "9f40c81c2a71"
down_revision: Union[str, Sequence[str], None] = "77494e93e2ee"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "alerts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("sensor_id", sa.Integer(), nullable=False),
        sa.Column("noise_level", sa.Float(), nullable=False),
        sa.Column("severity", sa.String(length=20), nullable=False),
        sa.Column("event_type", sa.String(length=50), nullable=False),
        sa.Column("message", sa.String(length=255), nullable=False),
        sa.Column("acknowledged", sa.Boolean(), nullable=False),
        sa.Column("resolved", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["sensor_id"],
            ["sensors.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_alerts_id", "alerts", ["id"], unique=False)
    op.create_index("ix_alerts_sensor_id", "alerts", ["sensor_id"], unique=False)
    op.create_index("ix_alerts_severity", "alerts", ["severity"], unique=False)
    op.create_index("ix_alerts_event_type", "alerts", ["event_type"], unique=False)
    op.create_index("ix_alerts_acknowledged", "alerts", ["acknowledged"], unique=False)
    op.create_index("ix_alerts_resolved", "alerts", ["resolved"], unique=False)
    op.create_index("ix_alerts_created_at", "alerts", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_alerts_created_at", table_name="alerts")
    op.drop_index("ix_alerts_resolved", table_name="alerts")
    op.drop_index("ix_alerts_acknowledged", table_name="alerts")
    op.drop_index("ix_alerts_event_type", table_name="alerts")
    op.drop_index("ix_alerts_severity", table_name="alerts")
    op.drop_index("ix_alerts_sensor_id", table_name="alerts")
    op.drop_index("ix_alerts_id", table_name="alerts")
    op.drop_table("alerts")
