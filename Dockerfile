FROM ubuntu:20.04

#auto debian ubuntu setting
ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update 
RUN apt-get install -y nodejs

EXPOSE 7900 
