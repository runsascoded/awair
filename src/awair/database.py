from datetime import datetime
from typing import List, Optional

from sqlalchemy import Column, DateTime, Float, Integer, UniqueConstraint, create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import Session, sessionmaker

Base = declarative_base()


def get_sensor_fields():
    """Get list of sensor field names from AirData model, excluding id and timestamp."""
    return ['temp', 'co2', 'pm10', 'pm25', 'humid', 'voc']


def get_all_fields():
    """Get list of all field names including timestamp."""
    return ['timestamp'] + get_sensor_fields()


class AirData(Base):
    __tablename__ = 'air_data'

    id = Column(Integer, primary_key=True)
    timestamp = Column(DateTime, nullable=False)
    temp = Column(Float, nullable=False)  # Temperature in Fahrenheit
    co2 = Column(Integer, nullable=False)  # CO2 in ppm
    pm10 = Column(Integer, nullable=False)  # PM10 in μg/m³
    pm25 = Column(Integer, nullable=False)  # PM2.5 in μg/m³
    humid = Column(Float, nullable=False)  # Humidity in %
    voc = Column(Integer, nullable=False)  # VOC in ppb

    # Ensure unique timestamps
    __table_args__ = (UniqueConstraint('timestamp', name='unique_timestamp'),)

    def __repr__(self):
        return f'<AirData(timestamp={self.timestamp}, temp={self.temp}, co2={self.co2})>'


class Database:
    def __init__(self, db_path: str = 'awair.db'):
        self.engine = create_engine(f'sqlite:///{db_path}')
        self.SessionLocal = sessionmaker(bind=self.engine)
        Base.metadata.create_all(self.engine)

    def get_session(self) -> Session:
        return self.SessionLocal()

    def insert_air_data(self, data: List[dict]) -> int:
        """Insert air data, returning count of inserted records."""
        session = self.get_session()
        inserted_count = 0

        try:
            for record in data:
                # Parse timestamp
                timestamp = datetime.fromisoformat(record['timestamp'].replace('Z', '+00:00'))

                # Check if record already exists
                existing = session.query(AirData).filter_by(timestamp=timestamp).first()
                if existing:
                    # Validate that the data matches
                    sensor_fields = get_sensor_fields()
                    conflicts = []

                    for field in sensor_fields:
                        existing_val = getattr(existing, field)
                        new_val = record[field]
                        if existing_val != new_val:
                            conflicts.append(f'{field}: {existing_val} -> {new_val}')

                    if conflicts:
                        raise ValueError(f'Data conflict at timestamp {timestamp}: {", ".join(conflicts)}')
                    # Data matches, skip insertion
                    continue

                # Create AirData object with dynamic field assignment
                air_data = AirData(timestamp=timestamp)
                for field in get_sensor_fields():
                    setattr(air_data, field, record[field])
                session.add(air_data)
                inserted_count += 1

            session.commit()
            return inserted_count

        except Exception as e:
            session.rollback()
            raise e
        finally:
            session.close()

    def get_latest_timestamp(self) -> Optional[datetime]:
        """Get the latest timestamp in the database."""
        session = self.get_session()
        try:
            result = session.query(AirData).order_by(AirData.timestamp.desc()).first()
            return result.timestamp if result else None
        finally:
            session.close()

    def get_record_count(self) -> int:
        """Get total number of records in the database."""
        session = self.get_session()
        try:
            return session.query(AirData).count()
        finally:
            session.close()
