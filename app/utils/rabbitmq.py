import os
import queue
import logging
from contextlib import contextmanager
import pika
from dotenv import load_dotenv

logger = logging.getLogger(__name__)
load_dotenv(override=True)

RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://guest:guest@localhost:5672/")

class RabbitMQConnectionPool:
    def __init__(self, amqp_url: str, pool_size: int = 5):
        self.amqp_url = amqp_url
        self.pool_size = pool_size
        self.pool = queue.Queue(maxsize=pool_size)
        self.initialized = False

    def init_pool(self):
        if self.initialized:
            return
        logger.info(f"Initializing RabbitMQ connection pool with size {self.pool_size} using URL: {self.amqp_url}")
        for _ in range(self.pool_size):
            try:
                conn = self._create_connection()
                self.pool.put(conn)
            except Exception as e:
                logger.error(f"Failed to create RabbitMQ connection: {e}")
                # Place None so the pool size is maintained and it can retry at checkout time
                self.pool.put(None)
        self.initialized = True

    def _create_connection(self):
        params = pika.URLParameters(self.amqp_url)
        # Establish sensible timeouts and retry policies for connection resilience
        params.connection_attempts = 3
        params.retry_delay = 2
        params.heartbeat = 600
        return pika.BlockingConnection(params)

    @contextmanager
    def get_connection(self):
        if not self.initialized:
            self.init_pool()
        
        conn = self.pool.get()
        try:
            if conn is None or conn.is_closed:
                logger.info("RabbitMQ connection is closed or uninitialized. Recreating connection...")
                conn = self._create_connection()
            yield conn
        except Exception as e:
            logger.error(f"Error during RabbitMQ connection usage: {e}")
            if conn and not conn.is_closed:
                try:
                    conn.close()
                except Exception:
                    pass
            conn = None
            raise
        finally:
            if conn and not conn.is_closed:
                self.pool.put(conn)
            else:
                try:
                    new_conn = self._create_connection()
                    self.pool.put(new_conn)
                except Exception as e:
                    logger.error(f"Failed to restore RabbitMQ connection in pool: {e}")
                    self.pool.put(None)

    def close_all(self):
        logger.info("Closing all RabbitMQ connections in the pool...")
        while not self.pool.empty():
            conn = self.pool.get()
            if conn and not conn.is_closed:
                try:
                    conn.close()
                except Exception as e:
                    logger.error(f"Error closing RabbitMQ connection: {e}")
        self.initialized = False

# Global instance of RabbitMQ Connection Pool
rabbitmq_pool = RabbitMQConnectionPool(RABBITMQ_URL)


async def publish_to_processing_queue(meeting_id: str):
    """
    Publishes a JSON payload containing the meeting_id to the durable 'processing_queue'.
    Runs the blocking pika publisher in the event loop executor to avoid blocking.
    """
    import json
    import asyncio

    def _publish():
        with rabbitmq_pool.get_connection() as conn:
            channel = conn.channel()
            # Ensure the queue exists and is durable
            channel.queue_declare(queue="processing_queue", durable=True)
            
            payload = json.dumps({"meeting_id": meeting_id})
            channel.basic_publish(
                exchange="",
                routing_key="processing_queue",
                body=payload,
                properties=pika.BasicProperties(
                    delivery_mode=2,  # Make the message persistent on disk
                )
            )
            logger.info(f"Published meeting {meeting_id} to processing_queue.")

    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, _publish)

