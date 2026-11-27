"""drop goals and spheres: the redesign (Keel) has neither

Habits, tasks and sleep stay; a goal's intent now lives in Claude's week note.
Downgrade restores the empty structure, not the data.

Revision ID: b41c9e2d7a10
Revises: a7e3f0c2b915
Create Date: 2026-11-27 12:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b41c9e2d7a10"
down_revision: str | Sequence[str] | None = "a7e3f0c2b915"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_table("goal_subtasks")
    op.drop_table("goal_history")
    op.drop_table("goal_habits")
    op.drop_table("goals")
    op.drop_constraint("fk_habits_sphere_owner", "habits", type_="foreignkey")
    op.drop_constraint("fk_tasks_sphere_owner", "tasks", type_="foreignkey")
    op.drop_column("habits", "sphere_id")
    op.drop_column("tasks", "sphere_id")
    op.drop_table("spheres")


def downgrade() -> None:
    # fmt: off
    op.create_table('spheres',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('name', sa.String(length=40), nullable=False),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_spheres_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_spheres')),
    sa.UniqueConstraint('id', 'user_id', name='uq_spheres_id_user')
    )
    op.create_index('uq_spheres_user_name', 'spheres', ['user_id', sa.literal_column('lower(name)')], unique=True)
    for table in ("habits", "tasks"):
        op.add_column(table, sa.Column("sphere_id", sa.Uuid(), nullable=True))
        op.create_foreign_key(
            f"fk_{table}_sphere_owner", table, "spheres", ["sphere_id", "user_id"],
            ["id", "user_id"], ondelete="SET NULL (sphere_id)",
        )
    op.create_table('goals',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('criterion', sa.Text(), nullable=False),
    sa.Column('deadline', sa.Date(), nullable=True),
    sa.Column('stage', sa.SmallInteger(), nullable=False),
    sa.Column('kind', sa.Enum('subtasks', 'streak', 'count', 'manual', name='goal_kind', native_enum=False, create_constraint=True, length=16), nullable=False),
    sa.Column('target', sa.Integer(), nullable=True),
    sa.Column('window_days', sa.Integer(), nullable=True),
    sa.Column('manual_pct', sa.SmallInteger(), nullable=True),
    sa.Column('sphere_id', sa.Uuid(), nullable=True),
    sa.Column('archived', sa.Boolean(), nullable=False),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('manual_pct IS NULL OR manual_pct BETWEEN 0 AND 100', name=op.f('ck_goals_pct_range')),
    sa.CheckConstraint('stage IN (1, 2)', name=op.f('ck_goals_stage_valid')),
    sa.ForeignKeyConstraint(['sphere_id', 'user_id'], ['spheres.id', 'spheres.user_id'], name='fk_goals_sphere_owner', ondelete='SET NULL (sphere_id)'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_goals_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_goals')),
    sa.UniqueConstraint('id', 'user_id', name='uq_goals_id_user')
    )
    op.create_index('ix_goals_user_list', 'goals', ['user_id', 'archived', 'position'], unique=False)
    op.create_table('goal_habits',
    sa.Column('goal_id', sa.Uuid(), nullable=False),
    sa.Column('habit_id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.ForeignKeyConstraint(['goal_id', 'user_id'], ['goals.id', 'goals.user_id'], name='fk_goal_habits_goal_owner', ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['habit_id', 'user_id'], ['habits.id', 'habits.user_id'], name='fk_goal_habits_habit_owner', ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_goal_habits_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('goal_id', 'habit_id', name=op.f('pk_goal_habits'))
    )
    op.create_table('goal_history',
    sa.Column('id', sa.BigInteger(), sa.Identity(always=False), nullable=False),
    sa.Column('goal_id', sa.Uuid(), nullable=False),
    sa.Column('at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('by', sa.Enum('me', 'claude', name='actor', native_enum=False, create_constraint=True, length=16), nullable=False),
    sa.Column('what', sa.Text(), nullable=False),
    sa.ForeignKeyConstraint(['goal_id'], ['goals.id'], name=op.f('fk_goal_history_goal_id_goals'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_goal_history'))
    )
    op.create_index('ix_goal_history_goal_at', 'goal_history', ['goal_id', sa.literal_column('at DESC')], unique=False)
    op.create_table('goal_subtasks',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('goal_id', sa.Uuid(), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('deadline', sa.Date(), nullable=True),
    sa.Column('done', sa.Boolean(), nullable=False),
    sa.Column('done_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['goal_id'], ['goals.id'], name=op.f('fk_goal_subtasks_goal_id_goals'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_goal_subtasks'))
    )
    op.create_index('ix_goal_subtasks_goal_position', 'goal_subtasks', ['goal_id', 'position'], unique=False)
    # fmt: on
