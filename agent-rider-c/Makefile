CFLAGS ?= -std=c99 -Wall -Wextra -O2 -D_POSIX_C_SOURCE=200809L
OBJS = cuni.o chamber.o rider.o

.PHONY: all test clean

all: sitescan test_cuni

sitescan: sitescan_main.o $(OBJS)
	$(CC) $(CFLAGS) -o $@ $^

test_cuni: tests/test_cuni.o $(OBJS)
	$(CC) $(CFLAGS) -o $@ $^

%.o: %.c
	$(CC) $(CFLAGS) -c -o $@ $<

tests/test_cuni.o: tests/test_cuni.c
	$(CC) $(CFLAGS) -c -o $@ $<

test: test_cuni
	./test_cuni

clean:
	rm -f *.o tests/*.o sitescan test_cuni reject.log
